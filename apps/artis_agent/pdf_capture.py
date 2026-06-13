"""
Smartis Agent – PDF-Capture-Modul
Version: 1.0.0

Dauerbetrieb im Tray:  sm-artis-agent.exe --tray
  - Globaler Hotkey Alt+Shift+S
  - Erkennt das aktive PDF-Fenster (Foxit, Edge, Chrome, Acrobat)
  - Findet die lokale Datei (Prozess-Kommandozeile bzw. Downloads/Temp/Desktop)
  - Dialog: Kunde, Anzeigename, Kategorie, Jahr, Tags, Notiz
  - Upload: Storage-Bucket 'dokumente' + Insert Tabelle 'dokumente'
    + Edge Function 'index-document' (Volltext-Indexierung)

Login: einmalig per E-Mail/Passwort (Supabase Auth). Der Refresh-Token wird
DPAPI-verschlüsselt in %LOCALAPPDATA%\\SmartisAgent\\config.json gespeichert.
"""

import os
import re
import sys
import json
import time
import uuid
import base64
import ctypes
import winreg
import queue
import mimetypes
import tempfile
import threading
import subprocess
import urllib.parse
from ctypes import wintypes

import requests

try:
    import pystray
    from pystray import MenuItem, Menu
    from PIL import Image, ImageDraw
    HAS_PYSTRAY = True
except ImportError:
    HAS_PYSTRAY = False

user32   = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
crypt32  = ctypes.windll.crypt32

APP_NAME    = "Smartis Agent"
HOTKEY_TEXT = "Alt+Shift+S"

CONFIG_DIR  = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'SmartisAgent')
CONFIG_PATH = os.path.join(CONFIG_DIR, 'config.json')

BUCKET = "dokumente"

# Muss inhaltlich src/lib/categories.js entsprechen
CATEGORIES = [
    ("rechnungswesen", "01 - Rechnungswesen"),
    ("steuern",        "02 - Steuern"),
    ("mwst",           "03 - Mehrwertsteuer"),
    ("revision",       "04 - Revision"),
    ("rechtsberatung", "05 - Rechtsberatung"),
    ("personal",       "06 - Personal"),
    ("korrespondenz",  "09 - Korrespondenz"),
]

# Prozessnamen der unterstützten PDF-Viewer (lowercase)
PDF_VIEWERS = {
    "foxitpdfreader.exe", "foxitreader.exe", "foxitpdfeditor.exe",
    "msedge.exe", "chrome.exe",
    "acrobat.exe", "acrord32.exe",
}
# Viewer, bei denen der Dateipfad in der Kommandozeile steht
CMDLINE_VIEWERS = {
    "foxitpdfreader.exe", "foxitreader.exe", "foxitpdfeditor.exe",
    "acrobat.exe", "acrord32.exe",
}

MB_OK              = 0x00
MB_ICONINFORMATION = 0x40
MB_ICONWARNING     = 0x30
MB_ICONSTOP        = 0x10
MB_TOPMOST         = 0x40000


def msgbox(text: str, title: str = APP_NAME, style: int = MB_OK | MB_ICONINFORMATION) -> int:
    return user32.MessageBoxW(0, text, title, style | MB_TOPMOST)


class NeedsLogin(Exception):
    """Kein gültiger Token vorhanden – Anmeldung erforderlich."""


# ── DPAPI (Token-Verschlüsselung pro Windows-Benutzer) ───────────────────────

class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    blob_in  = _DATA_BLOB(len(data), ctypes.cast(
        ctypes.create_string_buffer(data, len(data)), ctypes.POINTER(ctypes.c_char)))
    blob_out = _DATA_BLOB()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not fn(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
        raise OSError("DPAPI-Fehler")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


def _encrypt(text: str) -> str:
    try:
        return "dpapi:" + base64.b64encode(_dpapi(text.encode('utf-8'), True)).decode('ascii')
    except Exception:
        return "plain:" + text


def _decrypt(stored: str) -> str:
    if not stored:
        return ""
    if stored.startswith("dpapi:"):
        return _dpapi(base64.b64decode(stored[6:]), False).decode('utf-8')
    if stored.startswith("plain:"):
        return stored[6:]
    return stored


# ── Konfiguration ─────────────────────────────────────────────────────────────

def load_config() -> dict:
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg: dict):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def derive_app_url() -> str:
    """Kunden-App-URL aus dem Exe-Namen ableiten (artis_agent.exe → artis)."""
    try:
        exe = os.path.basename(sys.argv[0])
        if "_" in exe:
            customer = exe.split("_")[0]
            if customer:
                return f"https://{customer}.sm-artis.ch"
    except Exception:
        pass
    return "https://artis.sm-artis.ch"


def resolve_backend(app_url: str) -> tuple[str, str]:
    """Ermittelt (api_url, anon_key) über die öffentliche /config.json der App."""
    app_url = app_url.strip().rstrip('/')
    if not app_url.startswith('http'):
        app_url = 'https://' + app_url
    r = requests.get(f"{app_url}/config.json", timeout=15)
    r.raise_for_status()
    data = r.json()
    anon_key = data.get('KEY1') or ''
    if not anon_key:
        raise RuntimeError("config.json enthält keinen KEY1")
    host = urllib.parse.urlparse(app_url).netloc
    api_url = data.get('API_URL') or f"https://api-{host}"
    return api_url, anon_key


# ── Smartis-API (Supabase: Auth, REST, Storage, Functions) ───────────────────

class SmartisAPI:
    def __init__(self):
        self.cfg = load_config()

    # -- Auth ------------------------------------------------------------

    @property
    def api_url(self) -> str:
        return (self.cfg.get('api_url') or '').rstrip('/')

    @property
    def anon_key(self) -> str:
        return self.cfg.get('anon_key') or ''

    def is_configured(self) -> bool:
        return bool(self.api_url and self.anon_key and self.cfg.get('refresh_token'))

    def login(self, email: str, password: str):
        r = requests.post(
            f"{self.api_url}/auth/v1/token?grant_type=password",
            headers={"apikey": self.anon_key, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=30,
        )
        data = r.json() if r.content else {}
        if not r.ok:
            raise RuntimeError(data.get('error_description') or data.get('msg')
                               or f"Login fehlgeschlagen (HTTP {r.status_code})")
        self._store_session(data, email=email)

    def _store_session(self, data: dict, email: str | None = None):
        self.cfg['access_token']  = _encrypt(data['access_token'])
        self.cfg['refresh_token'] = _encrypt(data['refresh_token'])
        self.cfg['expires_at']    = time.time() + int(data.get('expires_in') or 3600)
        if email:
            self.cfg['email'] = email
        save_config(self.cfg)

    def _refresh(self):
        refresh_token = _decrypt(self.cfg.get('refresh_token') or '')
        if not refresh_token:
            raise NeedsLogin()
        r = requests.post(
            f"{self.api_url}/auth/v1/token?grant_type=refresh_token",
            headers={"apikey": self.anon_key, "Content-Type": "application/json"},
            json={"refresh_token": refresh_token},
            timeout=30,
        )
        if not r.ok:
            raise NeedsLogin()
        self._store_session(r.json())

    def ensure_token(self) -> str:
        if not self.api_url or not self.anon_key:
            raise NeedsLogin()
        if time.time() > float(self.cfg.get('expires_at') or 0) - 60:
            self._refresh()
        token = _decrypt(self.cfg.get('access_token') or '')
        if not token:
            raise NeedsLogin()
        return token

    def _headers(self, extra: dict | None = None) -> dict:
        h = {"apikey": self.anon_key,
             "Authorization": f"Bearer {self.ensure_token()}"}
        if extra:
            h.update(extra)
        return h

    # -- Stammdaten --------------------------------------------------------

    def get_customers(self) -> list[dict]:
        r = requests.get(
            f"{self.api_url}/rest/v1/customers",
            params={"select": "id,company_name,anrede,vorname,nachname",
                    "order": "company_name"},
            headers=self._headers(), timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def get_tags(self) -> list[dict]:
        r = requests.get(
            f"{self.api_url}/rest/v1/dok_tags",
            params={"select": "id,name,color,category,parent_id,sort_order",
                    "order": "sort_order"},
            headers=self._headers(), timeout=30,
        )
        r.raise_for_status()
        return r.json()

    # -- Upload (entspricht handleUpload in src/pages/Dokumente.jsx) -------

    def upload_document(self, file_path: str, customer_id: str, name: str,
                        category: str, year: int, tag_ids: list[str],
                        notes: str = "") -> dict:
        with open(file_path, 'rb') as f:
            file_bytes = f.read()
        original = os.path.basename(file_path)
        ext = original.rsplit('.', 1)[-1].lower() if '.' in original else 'pdf'
        mime = mimetypes.guess_type(original)[0] or 'application/pdf'

        # Bereinigter Objektname (ohne Umlaute) wie im Frontend
        object_name  = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:10]}.{ext}"
        storage_path = f"{customer_id}/{object_name}"

        r = requests.post(
            f"{self.api_url}/storage/v1/object/{BUCKET}/{storage_path}",
            headers=self._headers({"Content-Type": mime, "x-upsert": "false"}),
            data=file_bytes, timeout=300,
        )
        if not r.ok:
            err = r.json().get('message', '') if r.content else ''
            raise RuntimeError(f"Storage-Upload fehlgeschlagen: {err or r.status_code}")

        body = {
            "customer_id":  customer_id,
            "category":     category,
            "year":         int(year),
            "name":         name.strip(),
            "filename":     original,
            "storage_path": storage_path,
            "file_size":    len(file_bytes),
            "file_type":    mime,
            "tag_ids":      tag_ids,
            "notes":        notes,
        }
        r = requests.post(
            f"{self.api_url}/rest/v1/dokumente",
            headers=self._headers({"Content-Type": "application/json",
                                   "Prefer": "return=representation"}),
            json=body, timeout=60,
        )
        if not r.ok:
            # Verwaiste Storage-Datei wieder entfernen
            try:
                requests.delete(
                    f"{self.api_url}/storage/v1/object/{BUCKET}/{storage_path}",
                    headers=self._headers(), timeout=30)
            except Exception:
                pass
            err = r.json().get('message', '') if r.content else ''
            raise RuntimeError(f"Dokument-Eintrag fehlgeschlagen: {err or r.status_code}")

        doc = r.json()[0]

        # Volltext-Indexierung serverseitig anstossen (best effort)
        try:
            requests.post(
                f"{self.api_url}/functions/v1/index-document",
                headers=self._headers({"Content-Type": "application/json"}),
                json={"doc_id": doc.get('id')}, timeout=60,
            )
        except Exception:
            pass
        return doc


# ── Tag-Filterung (entspricht filterTagsByCategory in Dokumente.jsx) ─────────

def filter_tags_by_category(all_tags: list[dict], category: str) -> list[dict]:
    if not category:
        return all_tags
    parents = [t for t in all_tags if not t.get('parent_id') and t.get('category') == category]
    if not parents:
        return all_tags
    pids = {t['id'] for t in parents}
    return [t for t in all_tags if t['id'] in pids or t.get('parent_id') in pids]


def customer_display(c: dict) -> str:
    if c.get('company_name'):
        return c['company_name']
    return " ".join(x for x in [c.get('anrede'), c.get('vorname'), c.get('nachname')] if x) or c.get('id', '?')


def detect_year(filename: str) -> int:
    m = re.search(r'(20\d{2})', filename or '')
    return int(m.group(1)) if m else time.localtime().tm_year


# ── Aktives PDF-Fenster erkennen ──────────────────────────────────────────────

def _window_title(hwnd) -> str:
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def _process_image(pid: int) -> str:
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return ""
    try:
        size = wintypes.DWORD(32768)
        buf = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return buf.value
        return ""
    finally:
        kernel32.CloseHandle(h)


def _process_cmdline(pid: int) -> str:
    """Kommandozeile eines Prozesses via PowerShell/CIM (versteckt).

    Wichtig: explizit UTF-8 anfordern und dekodieren, sonst zerschiesst die
    Standard-Codepage Umlaute in Pfaden (z.B. «Kontoblätter» → «Kontobl?tter»),
    wodurch os.path.isfile() den Pfad nicht mehr findet.
    """
    try:
        CREATE_NO_WINDOW = 0x08000000
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
             f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\").CommandLine"],
            capture_output=True, timeout=10,
            creationflags=CREATE_NO_WINDOW,
        )
        return out.stdout.decode('utf-8', errors='replace').strip()
    except Exception:
        return ""


def _pdf_from_cmdline(cmdline: str) -> str | None:
    for m in re.finditer(r'"([^"]+?\.pdf)"|(\S+?\.pdf)\b', cmdline, re.IGNORECASE):
        path = m.group(1) or m.group(2)
        if path and os.path.isfile(path):
            return path
    return None


def _candidate_dirs() -> list[str]:
    home = os.path.expanduser('~')
    dirs = [
        os.path.join(home, 'Downloads'),
        os.path.join(home, 'Desktop'),
        tempfile.gettempdir(),
    ]
    for env in ('OneDriveCommercial', 'OneDrive'):
        od = os.environ.get(env)
        if od:
            dirs += [os.path.join(od, 'Desktop'), os.path.join(od, 'Downloads')]
    seen, result = set(), []
    for d in dirs:
        if d and os.path.isdir(d) and d.lower() not in seen:
            seen.add(d.lower())
            result.append(d)
    return result


def _find_local_pdf(filename: str) -> str | None:
    """Sucht die Datei in Downloads/Desktop/Temp (max. 2 Ebenen tief)."""
    target = filename.casefold()
    best, best_mtime = None, 0.0
    for base in _candidate_dirs():
        for root, subdirs, files in os.walk(base):
            depth = os.path.relpath(root, base).count(os.sep)
            if depth >= 2:
                subdirs[:] = []
            for fn in files:
                if fn.casefold() == target:
                    p = os.path.join(root, fn)
                    try:
                        mt = os.path.getmtime(p)
                    except OSError:
                        continue
                    if mt > best_mtime:
                        best, best_mtime = p, mt
    return best


def detect_foreground_pdf() -> dict:
    """
    Liefert {'title', 'process', 'filename', 'path'} für das aktive Fenster.
    'path' ist None, wenn die Datei nicht lokal gefunden wurde.
    """
    info = {'title': '', 'process': '', 'filename': None, 'path': None}
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return info
    info['title'] = _window_title(hwnd)
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    info['process'] = os.path.basename(_process_image(pid.value)).lower()

    if info['process'] not in PDF_VIEWERS:
        return info

    m = re.search(r'([^\\/:*?"<>|\r\n]+?\.pdf)', info['title'], re.IGNORECASE)
    if m:
        info['filename'] = m.group(1).strip()

    if info['process'] in CMDLINE_VIEWERS:
        path = _pdf_from_cmdline(_process_cmdline(pid.value))
        if path and (not info['filename']
                     or os.path.basename(path).casefold() == info['filename'].casefold()):
            info['path'] = path

    if not info['path'] and info['filename']:
        info['path'] = _find_local_pdf(info['filename'])

    return info


# ── Globaler Hotkey (Alt+Shift+S) ─────────────────────────────────────────────

def hotkey_loop(callback):
    MOD_ALT, MOD_SHIFT, MOD_NOREPEAT = 0x1, 0x4, 0x4000
    WM_HOTKEY = 0x0312
    if not user32.RegisterHotKey(None, 1, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, ord('S')):
        msgbox(f"Hotkey {HOTKEY_TEXT} konnte nicht registriert werden\n"
               "(evtl. von einem anderen Programm belegt).",
               style=MB_OK | MB_ICONWARNING)
        return
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        if msg.message == WM_HOTKEY:
            callback()


# ── Dialoge (tkinter) ─────────────────────────────────────────────────────────

def _center(win, w, h):
    win.update_idletasks()
    x = (win.winfo_screenwidth() - w) // 2
    y = (win.winfo_screenheight() - h) // 3
    win.geometry(f"{w}x{h}+{x}+{y}")


def show_login_dialog(api: SmartisAPI) -> bool:
    """Zeigt den Anmelde-Dialog. Gibt True zurück, wenn der Login geklappt hat."""
    import tkinter as tk
    from tkinter import ttk

    result = {'ok': False}
    root = tk.Tk()
    root.title(f"{APP_NAME} – Anmelden")
    root.attributes('-topmost', True)
    frm = ttk.Frame(root, padding=16)
    frm.pack(fill='both', expand=True)

    ttk.Label(frm, text="Smartis-Server (App-URL)").grid(row=0, column=0, sticky='w')
    e_server = ttk.Entry(frm, width=42)
    e_server.insert(0, api.cfg.get('app_url') or derive_app_url())
    e_server.grid(row=1, column=0, columnspan=2, sticky='we', pady=(0, 8))

    ttk.Label(frm, text="E-Mail").grid(row=2, column=0, sticky='w')
    e_mail = ttk.Entry(frm, width=42)
    e_mail.insert(0, api.cfg.get('email') or '')
    e_mail.grid(row=3, column=0, columnspan=2, sticky='we', pady=(0, 8))

    ttk.Label(frm, text="Passwort").grid(row=4, column=0, sticky='w')
    e_pass = ttk.Entry(frm, width=42, show='•')
    e_pass.grid(row=5, column=0, columnspan=2, sticky='we', pady=(0, 8))

    # Erweitert: direkte API-Angaben (falls /config.json nicht verfügbar, z.B. smartis.me)
    adv = tk.BooleanVar(value=bool(api.cfg.get('api_url_manual')))
    adv_frame = ttk.Frame(frm)
    ttk.Label(adv_frame, text="API-URL").grid(row=0, column=0, sticky='w')
    e_api = ttk.Entry(adv_frame, width=42)
    e_api.insert(0, api.cfg.get('api_url') or '')
    e_api.grid(row=1, column=0, sticky='we', pady=(0, 6))
    ttk.Label(adv_frame, text="Anon-Key").grid(row=2, column=0, sticky='w')
    e_key = ttk.Entry(adv_frame, width=42)
    e_key.insert(0, api.cfg.get('anon_key') or '')
    e_key.grid(row=3, column=0, sticky='we', pady=(0, 6))
    adv_frame.columnconfigure(0, weight=1)

    def toggle_adv():
        if adv.get():
            adv_frame.grid(row=7, column=0, columnspan=2, sticky='we')
        else:
            adv_frame.grid_forget()

    ttk.Checkbutton(frm, text="Erweiterte Einstellungen (API-URL/Key manuell)",
                    variable=adv, command=toggle_adv).grid(row=6, column=0, columnspan=2, sticky='w')
    toggle_adv()

    status = ttk.Label(frm, text="", foreground='#b91c1c', wraplength=320)
    status.grid(row=8, column=0, columnspan=2, sticky='w', pady=(6, 0))

    def do_login():
        server = e_server.get().strip()
        email, password = e_mail.get().strip(), e_pass.get()
        if not email or not password:
            status.config(text="Bitte E-Mail und Passwort eingeben.")
            return
        btn.config(state='disabled')
        status.config(text="Anmeldung läuft...", foreground='#374151')

        def work():
            try:
                if adv.get() and e_api.get().strip() and e_key.get().strip():
                    api.cfg['api_url'] = e_api.get().strip().rstrip('/')
                    api.cfg['anon_key'] = e_key.get().strip()
                    api.cfg['api_url_manual'] = True
                else:
                    api_url, anon_key = resolve_backend(server)
                    api.cfg['api_url'] = api_url
                    api.cfg['anon_key'] = anon_key
                    api.cfg['api_url_manual'] = False
                api.cfg['app_url'] = server
                save_config(api.cfg)
                api.login(email, password)
                result['ok'] = True
                root.after(0, root.destroy)
            except Exception as ex:
                root.after(0, lambda: (status.config(text=f"Fehler: {ex}", foreground='#b91c1c'),
                                       btn.config(state='normal')))

        threading.Thread(target=work, daemon=True).start()

    btn = ttk.Button(frm, text="Anmelden", command=do_login)
    btn.grid(row=9, column=0, columnspan=2, pady=(12, 0))
    frm.columnconfigure(0, weight=1)
    root.bind('<Return>', lambda e: do_login())

    _center(root, 400, 420)
    e_pass.focus_set() if e_mail.get() else e_mail.focus_set()
    root.mainloop()
    return result['ok']


def show_capture_dialog(api: SmartisAPI, capture: dict, notify):
    """Upload-Dialog: Datei + Kunde + Name + Kategorie + Jahr + Tags + Notiz."""
    import tkinter as tk
    from tkinter import ttk, filedialog

    try:
        customers = api.get_customers()
        all_tags  = api.get_tags()
    except Exception as e:
        msgbox(f"Stammdaten konnten nicht geladen werden:\n\n{e}",
               style=MB_OK | MB_ICONSTOP)
        return

    root = tk.Tk()
    root.title(f"{APP_NAME} – In Smartis speichern")
    root.attributes('-topmost', True)
    frm = ttk.Frame(root, padding=16)
    frm.pack(fill='both', expand=True)
    row = 0

    # ── Datei ────────────────────────────────────────────────────────────
    file_var = tk.StringVar(value=capture.get('path') or '')

    ttk.Label(frm, text="Datei *").grid(row=row, column=0, sticky='w'); row += 1
    file_frame = ttk.Frame(frm)
    file_frame.grid(row=row, column=0, columnspan=2, sticky='we', pady=(0, 2)); row += 1
    file_label = ttk.Label(file_frame, textvariable=file_var, width=52,
                           relief='sunken', padding=4)
    file_label.pack(side='left', fill='x', expand=True)

    def on_file_change(*_):
        p = file_var.get()
        if p:
            base = os.path.basename(p)
            if not e_name.get().strip():
                e_name.delete(0, 'end')
                e_name.insert(0, base.rsplit('.', 1)[0])
            e_year.delete(0, 'end')
            e_year.insert(0, str(detect_year(base)))

    def browse():
        start = os.path.dirname(file_var.get()) if file_var.get() else \
            os.path.join(os.path.expanduser('~'), 'Downloads')
        p = filedialog.askopenfilename(
            parent=root, initialdir=start,
            filetypes=[("PDF-Dateien", "*.pdf"), ("Alle Dateien", "*.*")])
        if p:
            file_var.set(p)
            on_file_change()

    ttk.Button(file_frame, text="Durchsuchen…", command=browse).pack(side='left', padx=(6, 0))

    hint = ""
    if capture.get('path'):
        hint = f"Erkannt aus: {capture.get('process')} – {capture.get('filename')}"
    elif capture.get('filename'):
        hint = (f"PDF «{capture['filename']}» erkannt, Datei aber nicht lokal gefunden – "
                "bitte über «Durchsuchen…» wählen.")
    else:
        hint = "Kein PDF-Fenster erkannt – bitte Datei über «Durchsuchen…» wählen."
    ttk.Label(frm, text=hint, foreground='#6b7280', wraplength=480)\
        .grid(row=row, column=0, columnspan=2, sticky='w', pady=(0, 8)); row += 1

    # ── Kunde ────────────────────────────────────────────────────────────
    customers_sorted = sorted(customers, key=lambda c: customer_display(c).casefold())
    cust_names = [customer_display(c) for c in customers_sorted]
    ttk.Label(frm, text="Kunde *").grid(row=row, column=0, sticky='w'); row += 1
    cb_cust = ttk.Combobox(frm, values=cust_names, state='readonly', width=50)
    cb_cust.grid(row=row, column=0, columnspan=2, sticky='we', pady=(0, 8)); row += 1

    # ── Anzeigename ──────────────────────────────────────────────────────
    ttk.Label(frm, text="Anzeigename *").grid(row=row, column=0, sticky='w'); row += 1
    e_name = ttk.Entry(frm, width=52)
    e_name.grid(row=row, column=0, columnspan=2, sticky='we', pady=(0, 8)); row += 1

    # ── Kategorie + Jahr ─────────────────────────────────────────────────
    ttk.Label(frm, text="Kategorie *").grid(row=row, column=0, sticky='w')
    ttk.Label(frm, text="Jahr *").grid(row=row, column=1, sticky='w'); row += 1
    cb_cat = ttk.Combobox(frm, values=[label for _, label in CATEGORIES],
                          state='readonly', width=28)
    cb_cat.grid(row=row, column=0, sticky='we', padx=(0, 8), pady=(0, 8))
    e_year = ttk.Entry(frm, width=10)
    e_year.grid(row=row, column=1, sticky='w', pady=(0, 8)); row += 1

    # ── Tags ─────────────────────────────────────────────────────────────
    ttk.Label(frm, text="Tags * (Mehrfachauswahl mit Strg/Klick)")\
        .grid(row=row, column=0, columnspan=2, sticky='w'); row += 1
    tag_frame = ttk.Frame(frm)
    tag_frame.grid(row=row, column=0, columnspan=2, sticky='nswe', pady=(0, 8)); row += 1
    lb_tags = tk.Listbox(tag_frame, selectmode='multiple', height=8, exportselection=False)
    sb = ttk.Scrollbar(tag_frame, orient='vertical', command=lb_tags.yview)
    lb_tags.configure(yscrollcommand=sb.set)
    lb_tags.pack(side='left', fill='both', expand=True)
    sb.pack(side='left', fill='y')

    visible_tags: list[dict] = []

    def rebuild_tags(*_):
        nonlocal visible_tags
        idx = cb_cat.current()
        category = CATEGORIES[idx][0] if idx >= 0 else ""
        filtered = filter_tags_by_category(all_tags, category)
        # Eltern zuerst, Kinder eingerückt darunter
        parents  = [t for t in filtered if not t.get('parent_id')]
        children = [t for t in filtered if t.get('parent_id')]
        ordered  = []
        for p in parents:
            ordered.append(p)
            ordered.extend(c for c in children if c.get('parent_id') == p['id'])
        ordered.extend(c for c in children
                       if all(c.get('parent_id') != p['id'] for p in parents))
        visible_tags = ordered
        lb_tags.delete(0, 'end')
        for t in ordered:
            prefix = "    └ " if t.get('parent_id') else ""
            lb_tags.insert('end', f"{prefix}{t.get('name', '?')}")

    cb_cat.bind('<<ComboboxSelected>>', rebuild_tags)
    rebuild_tags()

    # ── Notiz + Optionen ─────────────────────────────────────────────────
    ttk.Label(frm, text="Notiz (optional)").grid(row=row, column=0, sticky='w'); row += 1
    e_notes = ttk.Entry(frm, width=52)
    e_notes.grid(row=row, column=0, columnspan=2, sticky='we', pady=(0, 8)); row += 1

    del_var = tk.BooleanVar(value=False)
    ttk.Checkbutton(frm, text="Lokale Datei nach Upload löschen", variable=del_var)\
        .grid(row=row, column=0, columnspan=2, sticky='w'); row += 1

    status = ttk.Label(frm, text="", foreground='#b91c1c', wraplength=480)
    status.grid(row=row, column=0, columnspan=2, sticky='w', pady=(4, 0)); row += 1

    # ── Vorbelegung ──────────────────────────────────────────────────────
    if file_var.get():
        e_name.insert(0, os.path.basename(file_var.get()).rsplit('.', 1)[0])
        e_year.insert(0, str(detect_year(os.path.basename(file_var.get()))))
    elif capture.get('filename'):
        e_name.insert(0, capture['filename'].rsplit('.', 1)[0])
        e_year.insert(0, str(detect_year(capture['filename'])))
    else:
        e_year.insert(0, str(time.localtime().tm_year))

    # ── Speichern ────────────────────────────────────────────────────────
    ui_queue: queue.Queue = queue.Queue()

    def poll_queue():
        try:
            while True:
                fn = ui_queue.get_nowait()
                fn()
        except queue.Empty:
            pass
        try:
            root.after(100, poll_queue)
        except tk.TclError:
            pass

    def do_save():
        path = file_var.get()
        if not path or not os.path.isfile(path):
            status.config(text="Bitte eine gültige Datei wählen."); return
        if cb_cust.current() < 0:
            status.config(text="Bitte einen Kunden wählen."); return
        if not e_name.get().strip():
            status.config(text="Bitte einen Anzeigenamen eingeben."); return
        if cb_cat.current() < 0:
            status.config(text="Bitte eine Kategorie wählen."); return
        if not e_year.get().strip().isdigit():
            status.config(text="Bitte ein gültiges Jahr eingeben."); return
        sel = lb_tags.curselection()
        if not sel:
            status.config(text="Bitte mindestens einen Tag wählen."); return

        customer = customers_sorted[cb_cust.current()]
        category = CATEGORIES[cb_cat.current()][0]
        tag_ids  = [visible_tags[i]['id'] for i in sel]
        name     = e_name.get().strip()
        year     = int(e_year.get().strip())
        notes    = e_notes.get().strip()
        delete_after = del_var.get()

        btn_save.config(state='disabled')
        status.config(text="Lade hoch...", foreground='#374151')

        def work():
            try:
                api.upload_document(path, customer['id'], name, category,
                                    year, tag_ids, notes)
                if delete_after:
                    try:
                        os.remove(path)
                    except Exception:
                        pass

                def done():
                    root.destroy()
                    notify(f"«{name}» wurde in Smartis gespeichert.")
                ui_queue.put(done)
            except Exception as ex:
                def fail(ex=ex):
                    status.config(text=f"Fehler: {ex}", foreground='#b91c1c')
                    btn_save.config(state='normal')
                ui_queue.put(fail)

        threading.Thread(target=work, daemon=True).start()

    btn_frame = ttk.Frame(frm)
    btn_frame.grid(row=row, column=0, columnspan=2, sticky='e', pady=(10, 0))
    ttk.Button(btn_frame, text="Abbrechen", command=root.destroy).pack(side='left', padx=(0, 8))
    btn_save = ttk.Button(btn_frame, text="In Smartis speichern", command=do_save)
    btn_save.pack(side='left')

    frm.columnconfigure(0, weight=1)
    on_file_change()
    poll_queue()
    _center(root, 560, 640)
    root.mainloop()


# ── Tray-Hauptprogramm ────────────────────────────────────────────────────────

_dialog_lock = threading.Lock()


def _capture_flow(icon, capture: dict):
    """Login (falls nötig) + Upload-Dialog. Läuft in eigenem Thread."""
    try:
        api = SmartisAPI()
        try:
            api.ensure_token()
        except NeedsLogin:
            if not show_login_dialog(api):
                return
        except Exception as e:
            msgbox(f"Verbindungsfehler:\n\n{e}", style=MB_OK | MB_ICONSTOP)
            return

        def notify(text):
            if icon is not None:
                try:
                    icon.notify(text, APP_NAME)
                    return
                except Exception:
                    pass
            msgbox(text)

        show_capture_dialog(api, capture, notify)
    except Exception as e:
        msgbox(f"Unerwarteter Fehler:\n\n{e}", style=MB_OK | MB_ICONSTOP)
    finally:
        _dialog_lock.release()


def _start_capture(icon, with_detection: bool):
    if not _dialog_lock.acquire(blocking=False):
        return  # Dialog ist bereits offen
    capture = detect_foreground_pdf() if with_detection else \
        {'title': '', 'process': '', 'filename': None, 'path': None}
    threading.Thread(target=_capture_flow, args=(icon, capture), daemon=True).start()


def _tray_login(icon):
    if not _dialog_lock.acquire(blocking=False):
        return

    def flow():
        try:
            show_login_dialog(SmartisAPI())
        finally:
            _dialog_lock.release()

    threading.Thread(target=flow, daemon=True).start()


def _create_icon_image():
    size = 64
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, 62, 62], fill='#1e40af')
    draw.line([(15, 52), (32, 12), (49, 52)], fill='white', width=6)
    draw.line([(22, 37), (42, 37)], fill='white', width=5)
    return img


def _already_running() -> bool:
    ERROR_ALREADY_EXISTS = 183
    kernel32.CreateMutexW(None, False, "SmartisAgentTrayMutex")
    return kernel32.GetLastError() == ERROR_ALREADY_EXISTS


def register_autostart() -> bool:
    """Trägt den Tray-Modus im Autostart (HKCU) ein."""
    try:
        if getattr(sys, 'frozen', False):
            cmd = f'"{sys.executable}" --tray'
        else:
            cmd = f'"{sys.executable}" "{os.path.abspath(__file__)}" --tray'
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r'Software\Microsoft\Windows\CurrentVersion\Run',
                            0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, 'SmartisAgent', 0, winreg.REG_SZ, cmd)
        return True
    except Exception as e:
        print(f"Autostart-Fehler: {e}")
        return False


def run_tray():
    if not HAS_PYSTRAY:
        msgbox("pystray/Pillow fehlt – Tray-Modus nicht verfügbar.",
               style=MB_OK | MB_ICONSTOP)
        return
    if _already_running():
        msgbox(f"{APP_NAME} läuft bereits (Tray-Symbol unten rechts).",
               style=MB_OK | MB_ICONINFORMATION)
        return

    icon_holder = {'icon': None}

    def on_hotkey():
        _start_capture(icon_holder['icon'], with_detection=True)

    threading.Thread(target=hotkey_loop, args=(on_hotkey,), daemon=True).start()

    menu = Menu(
        MenuItem(f"PDF speichern  ({HOTKEY_TEXT})",
                 lambda i, it: _start_capture(i, with_detection=True), default=True),
        MenuItem("Dokument hochladen…",
                 lambda i, it: _start_capture(i, with_detection=False)),
        Menu.SEPARATOR,
        MenuItem("Anmelden…", lambda i, it: _tray_login(i)),
        Menu.SEPARATOR,
        MenuItem("Beenden", lambda i, it: i.stop()),
    )
    icon = pystray.Icon("smartis_agent_tray", _create_icon_image(),
                        f"{APP_NAME} – {HOTKEY_TEXT} für PDF-Upload", menu)
    icon_holder['icon'] = icon
    icon.run()


if __name__ == '__main__':
    run_tray()

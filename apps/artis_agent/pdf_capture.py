"""
Smartis Agent – PDF-Capture-Modul
Version: 2.0.0

Dauerbetrieb im Tray:  sm-artis-agent.exe --tray
  - Globaler Hotkey Alt+Shift+S
  - Erkennt das aktive PDF-Fenster (Foxit, Edge, Chrome, Acrobat)
  - Findet die lokale Datei (Prozess-Kommandozeile bzw. Downloads/Temp/Desktop)
  - Lädt die PDF in den Transfer-Bereich von Supabase (Bucket «dokumente»,
    reservierter Prefix «_inbox/») und öffnet danach im Browser die ECHTE
    smartis.me-Ablage:  {app}/Dokumente?inbox=<pfad>&filename=<name>
  - Die Verschlagwortung (Kunde, Kategorie, Jahr, Tags) macht der Nutzer im
    gewohnten Hochladen-Dialog der Web-App. Kein nachgebauter Dialog mehr.

Login: einmalig per E-Mail/Passwort (Supabase Auth). Der Refresh-Token wird
DPAPI-verschlüsselt in %LOCALAPPDATA%\\SmartisAgent\\config.json gespeichert.

Fehlerprotokoll:  %LOCALAPPDATA%\\SmartisAgent\\agent.log  (rotierend)
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
import logging
import logging.handlers
import mimetypes
import socket
import tempfile
import threading
import subprocess
import webbrowser
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
APP_VERSION = "2.0.0"
HOTKEY_TEXT = "Alt+Shift+S"

CONFIG_DIR  = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'SmartisAgent')
CONFIG_PATH = os.path.join(CONFIG_DIR, 'config.json')
LOG_PATH    = os.path.join(CONFIG_DIR, 'agent.log')

BUCKET       = "dokumente"
INBOX_PREFIX = "_inbox"   # Transfer-Bereich im Bucket (Browser-Fallback)
DESKTOP_PORT = 7788       # Upload-Server der Smartis-Desktop-App (wie Excel-Add-in)

MB_OK              = 0x00
MB_ICONINFORMATION = 0x40
MB_ICONWARNING     = 0x30
MB_ICONSTOP        = 0x10
MB_TOPMOST         = 0x40000


# ── Fehlerprotokoll ───────────────────────────────────────────────────────────

def _setup_logging() -> logging.Logger:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    logger = logging.getLogger('smartis_agent')
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        try:
            h = logging.handlers.RotatingFileHandler(
                LOG_PATH, maxBytes=512 * 1024, backupCount=3, encoding='utf-8')
            h.setFormatter(logging.Formatter(
                '%(asctime)s  %(levelname)-7s %(message)s', '%Y-%m-%d %H:%M:%S'))
            logger.addHandler(h)
        except Exception:
            pass
    return logger


log = _setup_logging()


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


def build_inbox_url(app_url: str, object_key: str, filename: str) -> str:
    """Browser-URL zur echten Ablage mit Transfer-Referenz."""
    base = (app_url or derive_app_url()).strip().rstrip('/')
    if not base.startswith('http'):
        base = 'https://' + base
    q = urllib.parse.urlencode({"inbox": object_key, "filename": filename})
    return f"{base}/Dokumente?{q}"


# ── Smartis-API (Supabase: Auth, Storage) ────────────────────────────────────

class SmartisAPI:
    def __init__(self):
        self.cfg = load_config()

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
        log.info("Login erfolgreich: %s", email)

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
            log.warning("Token-Refresh fehlgeschlagen (HTTP %s) – Neu-Login nötig", r.status_code)
            raise NeedsLogin()
        self._store_session(r.json())
        log.info("Token erneuert")

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

    def upload_to_inbox(self, file_path: str) -> str:
        """Lädt die Datei in den Transfer-Bereich und gibt den Objekt-Key zurück."""
        with open(file_path, 'rb') as f:
            data = f.read()
        original = os.path.basename(file_path)
        ext = original.rsplit('.', 1)[-1].lower() if '.' in original else 'pdf'
        mime = mimetypes.guess_type(original)[0] or 'application/pdf'
        object_key = f"{INBOX_PREFIX}/{uuid.uuid4().hex}.{ext}"

        url = f"{self.api_url}/storage/v1/object/{BUCKET}/{object_key}"
        log.info("Inbox-Upload startet → %s (%d Bytes, %s)", object_key, len(data), mime)
        r = requests.post(
            url,
            headers=self._headers({"Content-Type": mime, "x-upsert": "false"}),
            data=data, timeout=300,
        )
        if not r.ok:
            try:
                detail = r.json().get('message') or r.text
            except Exception:
                detail = r.text
            log.error("Inbox-Upload fehlgeschlagen: HTTP %s – %s", r.status_code, detail)
            raise RuntimeError(f"Upload abgelehnt (HTTP {r.status_code}): {detail}")
        log.info("Inbox-Upload OK: %s", object_key)
        return object_key


# ── Aktives PDF-Fenster erkennen ──────────────────────────────────────────────

PDF_VIEWERS = {
    "foxitpdfreader.exe", "foxitreader.exe", "foxitpdfeditor.exe",
    "msedge.exe", "chrome.exe",
    "acrobat.exe", "acrord32.exe",
}
CMDLINE_VIEWERS = {
    "foxitpdfreader.exe", "foxitreader.exe", "foxitpdfeditor.exe",
    "acrobat.exe", "acrord32.exe",
}


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
    """{'title','process','filename','path'} für das aktive Fenster."""
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
        log.error("Hotkey %s konnte nicht registriert werden", HOTKEY_TEXT)
        msgbox(f"Hotkey {HOTKEY_TEXT} konnte nicht registriert werden\n"
               "(evtl. von einem anderen Programm belegt).",
               style=MB_OK | MB_ICONWARNING)
        return
    log.info("Hotkey %s registriert", HOTKEY_TEXT)
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


def ask_for_file() -> str | None:
    """Datei-Auswahl als Fallback, wenn kein aktives PDF erkannt wurde."""
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    try:
        p = filedialog.askopenfilename(
            parent=root, title="PDF für Smartis auswählen",
            initialdir=os.path.join(os.path.expanduser('~'), 'Downloads'),
            filetypes=[("PDF-Dateien", "*.pdf"), ("Alle Dateien", "*.*")])
    finally:
        root.destroy()
    return p or None


def show_login_dialog(api: SmartisAPI) -> bool:
    """Anmelde-Dialog. True, wenn der Login geklappt hat."""
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

    ttk.Checkbutton(frm, text="Erweitert (API-URL/Key manuell)",
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
                log.exception("Login-Fehler")
                root.after(0, lambda: (status.config(text=f"Fehler: {ex}", foreground='#b91c1c'),
                                       btn.config(state='normal')))

        threading.Thread(target=work, daemon=True).start()

    btn = ttk.Button(frm, text="Anmelden", command=do_login)
    btn.grid(row=9, column=0, columnspan=2, pady=(12, 0))
    frm.columnconfigure(0, weight=1)
    root.bind('<Return>', lambda e: do_login())

    _center(root, 400, 360)
    (e_pass if e_mail.get() else e_mail).focus_set()
    root.mainloop()
    return result['ok']


# ── Übergabe an die Smartis-Desktop-App (wie das Excel-Add-in) ───────────────

def push_to_desktop(file_path: str, timeout: float = 5.0) -> bool:
    """Übergibt die Datei an die laufende Smartis-Desktop-App.

    Identischer Weg wie das Excel-Add-in: POST {"filepath": ...} an den
    lokalen Upload-Server (127.0.0.1:7788). Die Desktop-App liest die Datei,
    holt sich den Fokus und öffnet ihren normalen Hochladen-Dialog.
    Kein Login und kein Deploy nötig – der Empfänger-Code ist bereits live.

    Wichtig: Der Server liest die Anfrage in EINEM read(). Wir senden Header
    und Body deshalb in einem einzigen sendall() (wie das VBA-Add-in), sonst
    sieht der Server u.U. nur die Header und der Body fehlt.
    Gibt True bei Erfolg zurück, False wenn die App nicht läuft / ablehnt.
    """
    body = json.dumps({"filepath": os.path.abspath(file_path)}).encode('utf-8')
    head = (
        f"POST /upload HTTP/1.1\r\n"   # identischer Pfad wie das Excel-Add-in
        f"Host: 127.0.0.1:{DESKTOP_PORT}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Connection: close\r\n\r\n"
    ).encode('ascii')

    resp = b""
    try:
        with socket.create_connection(("127.0.0.1", DESKTOP_PORT), timeout=timeout) as s:
            s.sendall(head + body)
            s.settimeout(timeout)
            try:
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    resp += chunk
            except socket.timeout:
                pass
    except OSError as e:
        log.info("Desktop-App (Port %d) nicht erreichbar: %s",
                 DESKTOP_PORT, e.__class__.__name__)
        return False

    text = resp.decode('utf-8', 'replace')
    pos = text.find("\r\n\r\n")
    try:
        data = json.loads(text[pos + 4:]) if pos >= 0 else {}
    except Exception:
        data = {}
    if text.startswith("HTTP/1.1 200") and data.get('ok'):
        log.info("An Desktop-App übergeben: %s", os.path.basename(file_path))
        return True
    log.warning("Desktop-App antwortete unerwartet: %r", text[:200])
    return False


# ── Capture-Workflow ──────────────────────────────────────────────────────────

_dialog_lock = threading.Lock()


def _notify(icon, text: str):
    if icon is not None:
        try:
            icon.notify(text, APP_NAME)
            return
        except Exception:
            pass
    # Kein Tray-Icon (z.B. direkter Aufruf) → unaufdringlicher Hinweis weglassen


def _browser_fallback(icon, path: str, filename: str) -> bool:
    """Optionaler Weg ohne Desktop-App: PDF in den Transfer-Bereich laden und
    die Web-Ablage im Browser öffnen (benötigt den deployten ?inbox-Handler
    und ein konfiguriertes Backend). Wird derzeit NICHT automatisch aufgerufen
    (siehe _capture_flow), steht aber für eine reine Browser-Nutzung bereit.
    """
    api = SmartisAPI()
    try:
        if not api.is_configured():
            raise NeedsLogin()
        api.ensure_token()
    except NeedsLogin:
        if not show_login_dialog(api):
            return False
        try:
            api.ensure_token()
        except Exception as e:
            log.exception("Token nach Anmeldung ungültig")
            msgbox(f"Anmeldung fehlgeschlagen:\n\n{e}", style=MB_OK | MB_ICONSTOP)
            return False
    except Exception as e:
        log.exception("Verbindungs-/Token-Fehler")
        msgbox(f"Verbindungsfehler:\n\n{e}", style=MB_OK | MB_ICONSTOP)
        return False

    try:
        object_key = api.upload_to_inbox(path)
    except Exception as e:
        log.exception("Inbox-Upload-Fehler")
        msgbox(f"Hochladen fehlgeschlagen:\n\n{e}\n\nDetails: {LOG_PATH}",
               style=MB_OK | MB_ICONSTOP)
        return False

    url = build_inbox_url(api.cfg.get('app_url') or derive_app_url(), object_key, filename)
    log.info("Öffne Browser: %s", url)
    try:
        os.startfile(url)
    except Exception:
        webbrowser.open(url)
    _notify(icon, f"«{filename}» an Smartis übergeben (Browser) – bitte verschlagworten.")
    return True


def _capture_flow(icon, capture: dict):
    try:
        # 1. Datei bestimmen (erkannt oder per Auswahl)
        path = capture.get('path')
        if not path or not os.path.isfile(path):
            log.info("Kein PDF-Pfad erkannt (title=%r, process=%r) – Dateiauswahl",
                     capture.get('title'), capture.get('process'))
            path = ask_for_file()
            if not path:
                log.info("Dateiauswahl abgebrochen")
                return

        filename = os.path.basename(path)
        log.info("Übergabe: %s", filename)

        # 2. Primär: an die laufende Smartis-Desktop-App übergeben (wie Excel).
        #    Keine Anmeldung, kein Deploy – öffnet direkt den gewohnten Dialog.
        if push_to_desktop(path):
            _notify(icon, f"«{filename}» an Smartis übergeben – bitte verschlagworten.")
            return

        # 3. Kein Client offen → Browser-Weg: PDF in die Ablage laden und die
        #    Web-Oberfläche im Browser öffnen. So funktioniert es für Client-
        #    UND reine Browser-Nutzer mit demselben Agent. Das Ziel-Backend
        #    bestimmt die Agent-Konfiguration (= artis in der Produktion, aus
        #    dem Exe-Namen bzw. der einmaligen Anmeldung). _browser_fallback
        #    zeigt eigene Fehlermeldungen.
        log.info("Kein Client auf Port %d erreichbar → Browser-Weg", DESKTOP_PORT)
        _browser_fallback(icon, path, filename)
    except Exception:
        log.exception("Unerwarteter Fehler im Capture-Flow")
    finally:
        try:
            _dialog_lock.release()
        except RuntimeError:
            pass


def _start_capture(icon, with_detection: bool):
    if not _dialog_lock.acquire(blocking=False):
        log.info("Capture bereits aktiv – Aufruf ignoriert")
        return
    try:
        capture = detect_foreground_pdf() if with_detection else \
            {'title': '', 'process': '', 'filename': None, 'path': None}
    except Exception:
        log.exception("Fehler bei der Fenster-Erkennung")
        capture = {'title': '', 'process': '', 'filename': None, 'path': None}
    log.info("Auslöser: detection=%s → process=%r filename=%r path=%r",
             with_detection, capture.get('process'), capture.get('filename'), capture.get('path'))
    threading.Thread(target=_capture_flow, args=(icon, capture), daemon=True).start()


def _tray_login(icon):
    if not _dialog_lock.acquire(blocking=False):
        return

    def flow():
        try:
            show_login_dialog(SmartisAPI())
        finally:
            try:
                _dialog_lock.release()
            except RuntimeError:
                pass

    threading.Thread(target=flow, daemon=True).start()


# ── Tray-Hauptprogramm ────────────────────────────────────────────────────────

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
        log.info("Autostart registriert: %s", cmd)
        return True
    except Exception:
        log.exception("Autostart-Fehler")
        return False


def _open_log(icon=None, item=None):
    try:
        os.startfile(LOG_PATH)
    except Exception:
        log.exception("Protokoll konnte nicht geöffnet werden")


def run_tray():
    log.info("=== Tray-Start v%s (PID %s) ===", APP_VERSION, os.getpid())
    if not HAS_PYSTRAY:
        msgbox("pystray/Pillow fehlt – Tray-Modus nicht verfügbar.",
               style=MB_OK | MB_ICONSTOP)
        return
    if _already_running():
        log.info("Bereits eine Tray-Instanz aktiv – Abbruch")
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
        MenuItem("PDF auswählen…",
                 lambda i, it: _start_capture(i, with_detection=False)),
        Menu.SEPARATOR,
        MenuItem("Anmelden…", lambda i, it: _tray_login(i)),
        MenuItem("Protokoll öffnen", _open_log),
        Menu.SEPARATOR,
        MenuItem("Beenden", lambda i, it: i.stop()),
    )
    icon = pystray.Icon("smartis_agent_tray", _create_icon_image(),
                        f"{APP_NAME} – {HOTKEY_TEXT} für PDF-Upload", menu)
    icon_holder['icon'] = icon
    icon.run()


if __name__ == '__main__':
    run_tray()

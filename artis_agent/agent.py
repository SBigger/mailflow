"""
Artis Agent - Dokument-Manager
Version: 1.0.0

Workflow:
  1. Web-App ruft  artis-open://checkout?doc_id=...&jwt=...&item_id=...&filename=...
  2. Agent lädt Datei herunter  →  öffnet in Word/Excel/Acrobat
  3. Watchdog erkennt Saves  →  lädt Draft auf SharePoint hoch
  4. App geschlossen  →  Dialog: Einchecken / Verwerfen
  5. Einchecken  →  finale Version hochladen, Sperre in DB aufheben

Installation (einmalig, als normaler User):
  artis_agent.exe          →  registriert URI-Schema + zeigt Bestätigung

Aufruf durch Browser:
  artis_agent.exe "artis-open://checkout?doc_id=...&jwt=...&item_id=...&filename=..."
"""

import sys
print(sys.executable)
import os
import json
import time
import threading
import urllib.parse
import ctypes
import winreg
import requests

# ── Watchdog (optional – nur wenn installiert) ────────────────────────────────
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False

# ── pystray (optional – nur wenn installiert) ─────────────────────────────────
try:
    import pystray
    from pystray import MenuItem, Menu
    from PIL import Image, ImageDraw
    HAS_PYSTRAY = True
except ImportError:
    HAS_PYSTRAY = False

# ── Konfiguration ─────────────────────────────────────────────────────────────
APP_NAME     = "Artis Agent"
APP_VERSION  = "2.1.0"

# Backend-URL ist konfigurierbar: bei einem Backend-Umzug genügt es, in
# %APPDATA%\ArtisAgent\config.json den Wert "supabase_url" anzupassen –
# kein Rebuild der EXE nötig. Ohne Config-Datei wird der Default verwendet.
DEFAULT_SUPABASE_URL = "https://uawgpxcihixqxqxxbjak.supabase.co"
CONFIG_DIR  = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'ArtisAgent')
CONFIG_PATH = os.path.join(CONFIG_DIR, 'config.json')


def load_config() -> dict:
    """Liest config.json (falls vorhanden). Fehler werden still ignoriert."""
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def ensure_default_config() -> None:
    """Schreibt eine Default-config.json, falls noch keine existiert."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        if not os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump({"supabase_url": DEFAULT_SUPABASE_URL}, f, indent=2)
    except Exception:
        pass


_cfg = load_config()
SUPABASE_URL = (_cfg.get('supabase_url') or DEFAULT_SUPABASE_URL).rstrip('/')
SPFILES      = f"{SUPABASE_URL}/functions/v1/sharepoint-files"

# Multi-Backend: smartis.me (alte Cloud, Entwicklung/Test) und api-artis (neu,
# Produktiv) nutzen unterschiedliche Supabase-Instanzen. Da ein ausgechecktes
# Dokument nur in EINEM Backend liegt, probiert der Agent beim Einchecken alle
# bekannten Backends durch und nimmt jenes, in dem das Dokument existiert.
# Überschreibbar in config.json via "backends": ["https://...", "https://..."].
_DEFAULT_BACKENDS = [
    "https://uawgpxcihixqxqxxbjak.supabase.co",
    "https://api-artis.sm-artis.ch",
]
_cfg_backends = _cfg.get('backends') if isinstance(_cfg.get('backends'), list) else []
BACKENDS = [str(b).rstrip('/') for b in _cfg_backends if b] or \
           ([SUPABASE_URL] + [b for b in _DEFAULT_BACKENDS if b != SUPABASE_URL])
if SUPABASE_URL in BACKENDS:
    BACKENDS = [SUPABASE_URL] + [b for b in BACKENDS if b != SUPABASE_URL]

# JWT-Algorithmus → Backend-Zuordnung. Verhindert, dass ein migriertes Dokument
# (gleiche UUID in alter UND neuer DB) im falschen Backend eingecheckt wird:
#   HS256 → neues System (api-artis, self-hosted, symmetrischer JWT-Secret)
#   ES256 → alte Cloud (uawgpxcihixqxqxxbjak, asymmetrische JWT-Signing-Keys)
_ALG_BACKEND = {
    "HS256": "https://api-artis.sm-artis.ch",
    "ES256": "https://uawgpxcihixqxqxxbjak.supabase.co",
}


def _jwt_alg(jwt: str) -> str:
    """Liest 'alg' aus dem JWT-Header (erstes Segment). '' bei Fehler."""
    try:
        import base64
        seg = jwt.split('.')[0]
        seg += '=' * ((4 - len(seg) % 4) % 4)
        return str(json.loads(base64.urlsafe_b64decode(seg)).get('alg', ''))
    except Exception:
        return ''


def backends_for(jwt: str) -> list:
    """Backend-Reihenfolge passend zum JWT: das vom Token-Aussteller bevorzugt,
    der Rest als Fallback. Bei unbekanntem alg → unveränderte BACKENDS-Liste."""
    preferred = _ALG_BACKEND.get(_jwt_alg(jwt))
    if not preferred or preferred not in BACKENDS:
        return list(BACKENDS)
    return [preferred] + [b for b in BACKENDS if b != preferred]


WORKSPACE    = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'ArtisAgent', 'Workspace'
)
# Fester Installationsort. Egal von wo die EXE gestartet wird (Downloads, USB,
# Netzlaufwerk) – sie kopiert sich hierher und registriert DIESEN Pfad. So bleibt
# der URI-Handler stabil, auch wenn die heruntergeladene Datei gelöscht wird.
INSTALL_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'ArtisAgent', 'bin'
)
INSTALL_EXE = os.path.join(INSTALL_DIR, 'ArtisAgent.exe')
LOG_PATH = os.path.join(CONFIG_DIR, 'agent.log')


def applog(msg: str) -> None:
    """Schreibt eine Zeile ins Logfile (für Diagnose). Fehler werden ignoriert."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S') + '  ' + msg + '\n')
    except Exception:
        pass


applog(f"=== Agent geladen | SUPABASE_URL={SUPABASE_URL} | exe={getattr(sys, 'executable', '?')} ===")
DRAFT_INTERVAL = 60   # Sekunden zwischen Draft-Uploads
FILE_OPEN_TIMEOUT = 8 * 60 * 60  # 8 Stunden max Bearbeitung

# ── Windows-Dialog-Konstanten ─────────────────────────────────────────────────
MB_OK              = 0x00
MB_YESNO           = 0x04
MB_YESNOCANCEL     = 0x03
MB_ICONINFORMATION = 0x40
MB_ICONQUESTION    = 0x20
MB_ICONWARNING     = 0x30
MB_ICONSTOP        = 0x10
MB_TOPMOST         = 0x40000
IDYES              = 6
IDNO               = 7
IDCANCEL           = 2


def msgbox(text: str, title: str = APP_NAME, style: int = MB_OK | MB_ICONINFORMATION) -> int:
    """Zeigt einen Windows-Messagebox-Dialog. Gibt IDYES/IDNO/IDCANCEL zurück."""
    return ctypes.windll.user32.MessageBoxW(0, text, title, style | MB_TOPMOST)


# ── HTTP-Helfer ───────────────────────────────────────────────────────────────

def sp_call(jwt: str, body: dict, timeout: int = 30, url: str | None = None) -> dict:
    """JSON-Aufruf der sharepoint-files Edge Function."""
    endpoint = url or SPFILES
    applog(f"sp_call POST {endpoint} action={body.get('action')}")
    r = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout
    )
    data = r.json() if r.content else {}
    applog(f"sp_call <- HTTP {r.status_code} body={str(data)[:200]}")
    if not r.ok:
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")
    return data


def sp_upload_multipart(jwt: str, action: str, doc_id: str,
                        local_path: str, filename: str,
                        extra_fields: dict | None = None,
                        timeout: int = 300, url: str | None = None) -> dict:
    """Multipart-Upload an die Edge Function (checkin-save oder upload-draft)."""
    endpoint = url or SPFILES
    with open(local_path, 'rb') as f:
        file_bytes = f.read()
    fields = {"action": action, "doc_id": doc_id}
    if extra_fields:
        fields.update(extra_fields)
    applog(f"upload_multipart POST {endpoint} action={action} doc_id={doc_id} bytes={len(file_bytes)}")
    r = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {jwt}"},
        files={"file": (filename, file_bytes, "application/octet-stream")},
        data=fields,
        timeout=timeout
    )
    data = r.json() if r.content else {}
    applog(f"upload_multipart <- HTTP {r.status_code} body={str(data)[:200]}")
    if not r.ok:
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")
    return data


def download_file(url: str, dest: str):
    """Lädt eine Datei von einer URL herunter."""
    r = requests.get(url, stream=True, timeout=120)
    r.raise_for_status()
    with open(dest, 'wb') as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)


# ── Datei-Lock-Erkennung ──────────────────────────────────────────────────────

def is_file_locked(path: str) -> bool:
    """Prüft ob die Datei von einem anderen Prozess gesperrt ist."""
    try:
        with open(path, 'rb+'):
            return False
    except (PermissionError, OSError):
        return True


def has_office_lockfile(path: str) -> bool:
    """Prüft ob Office eine ~$-Sperrdatei angelegt hat."""
    d = os.path.dirname(path)
    n = os.path.basename(path)
    return os.path.exists(os.path.join(d, f"~${n}"))


def is_open_by_app(path: str) -> bool:
    return is_file_locked(path) or has_office_lockfile(path)


def wait_for_file_close(path: str, status_cb=None) -> bool:
    """
    Wartet bis die Datei nicht mehr geöffnet ist.
    Phase 1: wartet bis die App die Datei geöffnet hat (max. 45 s)
    Phase 2: wartet bis die App die Datei wieder schließt (max. 8 h)
    Gibt True zurück wenn geschlossen, False bei Timeout.
    """
    deadline = time.time() + FILE_OPEN_TIMEOUT

    # Phase 1: Warten bis geöffnet
    opened = False
    for _ in range(45):
        if is_open_by_app(path):
            opened = True
            break
        time.sleep(1)

    if not opened:
        return True  # Datei wurde nicht geöffnet (evtl. sofort geschlossen)

    if status_cb:
        status_cb("Datei geöffnet – warte auf Schliessen...")

    # Phase 2: Warten bis geschlossen
    while time.time() < deadline:
        if not is_open_by_app(path):
            return True
        time.sleep(2)

    return False  # Timeout


# ── Draft-Upload (Watchdog) ───────────────────────────────────────────────────

if HAS_WATCHDOG:
    class DraftHandler(FileSystemEventHandler):
        def __init__(self, watched_path: str, upload_fn):
            self.watched = os.path.normcase(os.path.abspath(watched_path))
            self.upload_fn = upload_fn
            self._last = 0

        def _trigger(self, src: str):
            if os.path.normcase(os.path.abspath(src)) == self.watched:
                now = time.time()
                if now - self._last > DRAFT_INTERVAL:
                    self._last = now
                    print("Datei wurde gespeichert")
                    threading.Thread(target=self.upload_fn, daemon=True).start()

        def on_modified(self, e):
            if not e.is_directory:
                self._trigger(e.src_path)

        def on_created(self, e):
            if not e.is_directory:
                self._trigger(e.src_path)

        def on_moved(self, e):
            if not e.is_directory:
                self._trigger(e.dest_path)


# ── Tray-Icon ─────────────────────────────────────────────────────────────────

def create_icon_image(color: str = '#1e40af') -> 'Image.Image':
    """Erstellt ein einfaches Tray-Icon (blaues A auf weissem Hintergrund)."""
    size = 64
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, 62, 62], fill=color)
    # A-Form mit Linien (kein Font nötig)
    draw.line([(15, 52), (32, 12), (49, 52)], fill='white', width=6)
    draw.line([(22, 37), (42, 37)], fill='white', width=5)
    return img


def make_tray_icon(label: str, on_checkin, on_discard):
    """Erstellt und startet ein Tray-Icon im Hintergrund."""
    if not HAS_PYSTRAY:
        return None
    img = create_icon_image()
    menu = Menu(
        MenuItem(label[:45], lambda i, it: None, enabled=False),
        Menu.SEPARATOR,
        MenuItem('Jetzt einchecken',       lambda i, it: (i.stop(), on_checkin())),
        MenuItem('Checkout verwerfen',     lambda i, it: (i.stop(), on_discard())),
    )
    icon = pystray.Icon(f"artis_{id(label)}", img, f"Artis: {label[:40]}", menu)
    icon.run_detached()
    return icon


# ── Checkout-Workflow ─────────────────────────────────────────────────────────

def checkout_workflow(doc_id: str, jwt: str, item_id: str, filename: str):
    """Vollständiger Checkout-Workflow."""

    local_path   = None
    icon         = None
    observer     = None
    draft_item_id = [None]   # mutable ref für Draft-Item
    done_event   = threading.Event()  # verhindert Doppel-Checkin

    def log(msg: str):
        print(f"[{filename}] {msg}")

    try:
        os.makedirs(WORKSPACE, exist_ok=True)


        # ── 2. Datei herunterladen ───────────────────────────────────────────
        safe     = filename.replace('/', '_').replace('\\', '_')
        local_path = os.path.join(WORKSPACE, f"{doc_id}_{safe}")
        log(f"Lade herunter → {local_path}")
        download_file(item_id, local_path)
        original_mtime = os.path.getmtime(local_path)

        # ── 3. Datei öffnen ──────────────────────────────────────────────────
        log("Öffne Datei...")
        os.startfile(local_path)

        # ── 4. Draft-Upload via Watchdog einrichten ──────────────────────────
        def upload_draft():
            if done_event.is_set():
                return
            if not os.path.exists(local_path):
                return
            try:
                log("Lade Draft hoch...")
                _draft_base = backends_for(jwt)[0]
                res = sp_upload_multipart(
                    jwt, 'upload-draft', doc_id, local_path, filename,
                    extra_fields={"prev_draft_item_id": draft_item_id[0] or ""},
                    timeout=120,
                    url=f"{_draft_base}/functions/v1/sharepoint-files"
                )
                draft_item_id[0] = res.get('draft_item_id')
                log(f"Draft hochgeladen: {draft_item_id[0]}")
            except Exception as e:
                log(f"Draft-Upload Fehler (nicht kritisch): {e}")

        if HAS_WATCHDOG:
            handler  = DraftHandler(local_path, upload_draft)
            observer = Observer()
            observer.schedule(handler, path=WORKSPACE, recursive=False)
            observer.start()
            log("Watchdog gestartet")

        # ── 5. Tray-Icon ─────────────────────────────────────────────────────
        def manual_checkin():
            if done_event.is_set():
                return
            done_event.set()
            do_checkin(doc_id, jwt, local_path, filename, draft_item_id[0])

        def manual_discard():
            if done_event.is_set():
                return
            done_event.set()
            do_discard(doc_id, jwt, filename, draft_item_id[0])

        icon = make_tray_icon(filename, manual_checkin, manual_discard)

        # ── 6. Warten bis Datei geschlossen ──────────────────────────────────
        log("Warte auf Schliessen der Datei...")

        def update_tray(msg):
            if icon:
                try:
                    icon.title = f"Artis: {msg[:40]}"
                except Exception:
                    pass

        closed = wait_for_file_close(local_path, status_cb=update_tray)

        if done_event.is_set():
            return  # Bereits über Tray-Menü erledigt

        if not closed:
            # Timeout
            done_event.set()
            msgbox(
                f"'{filename}'\n\nDie Bearbeitung hat zu lange gedauert (max. 8 h).\n"
                "Checkout wird verworfen.",
                style=MB_OK | MB_ICONWARNING
            )
            _safe_discard(doc_id, jwt, draft_item_id[0])
            return

        # ── 7. Einchecken-Dialog ─────────────────────────────────────────────
        current_mtime  = os.path.getmtime(local_path)
        was_modified   = abs(current_mtime - original_mtime) > 0.5

        if done_event.is_set():
            return

        done_event.set()

        if was_modified:
            do_checkin(doc_id, jwt, local_path, filename, draft_item_id[0])
        else:
            # Datei unverändert geschlossen → Sperre freigeben (kein Dialog).
            # Erst ohne Upload versuchen (checkin-discard, alle Backends). Kennt
            # kein Backend die Aktion, wird als Fallback der unveränderte Inhalt
            # re-hochgeladen, damit die Sperre sicher gelöst wird.
            log("Keine Änderung – Checkout wird freigegeben")
            if not try_release_lock(doc_id, jwt):
                applog("checkin-discard nirgends moeglich -> Fallback Re-Upload")
                do_checkin(doc_id, jwt, local_path, filename, draft_item_id[0])

    except Exception as e:
        log(f"FEHLER: {e}")
        msgbox(f"Fehler beim Checkout von '{filename}':\n\n{e}", style=MB_OK | MB_ICONSTOP)
        if not done_event.is_set():
            done_event.set()
            _safe_discard(doc_id, jwt, None)

    finally:
        # Aufräumen
        if observer and HAS_WATCHDOG:
            try:
                observer.stop()
                observer.join(timeout=3)
            except Exception:
                pass
        if icon and HAS_PYSTRAY:
            try:
                icon.stop()
            except Exception:
                pass
        if local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception:
                pass  # Datei evtl. noch gesperrt → ignorieren


def do_checkin(doc_id: str, jwt: str, local_path: str,
               filename: str, draft_item_id: str | None):
    """Lädt die finale Version hoch und hebt die Sperre auf.

    Probiert alle bekannten Backends durch (smartis.me / api-artis) und nimmt
    jenes, in dem das Dokument liegt. Liefert das richtige Backend 'Dokument
    nicht gefunden', wird das nächste versucht."""
    last_err = None
    for base in backends_for(jwt):
        endpoint = f"{base}/functions/v1/sharepoint-files"
        try:
            print(f"[{filename}] Einchecken via {base}...")
            sp_upload_multipart(jwt, 'checkin-save', doc_id, local_path, filename,
                                timeout=300, url=endpoint)
            applog(f"checkin-save OK auf {base}")
            if draft_item_id:
                try:
                    sp_call(jwt, {"action": "delete", "item_id": draft_item_id},
                            timeout=15, url=endpoint)
                except Exception:
                    pass
            return True
        except Exception as e:
            applog(f"checkin-save fehlgeschlagen auf {base}: {e}")
            last_err = e
            continue
    msgbox(
        f"Fehler beim Einchecken von '{filename}':\n\n{last_err}\n\n"
        "Die Datei bleibt lokal. Bitte manuell in der Web-App einchecken.",
        style=MB_OK | MB_ICONSTOP
    )
    return False


def try_release_lock(doc_id: str, jwt: str) -> bool:
    """Hebt die Checkout-Sperre OHNE Upload auf (checkin-discard), über alle
    Backends. True, sobald ein Backend die Freigabe akzeptiert."""
    for base in backends_for(jwt):
        endpoint = f"{base}/functions/v1/sharepoint-files"
        try:
            sp_call(jwt, {"action": "checkin-discard", "doc_id": doc_id},
                    timeout=15, url=endpoint)
            applog(f"checkin-discard OK auf {base}")
            return True
        except Exception as e:
            applog(f"checkin-discard fehlgeschlagen auf {base}: {e}")
    return False


def do_discard(doc_id: str, jwt: str, filename: str, draft_item_id: str | None):
    """Hebt die Sperre auf ohne die Datei hochzuladen."""
    _safe_discard(doc_id, jwt, draft_item_id)
    msgbox(f"'{filename}'\n\nÄnderungen verworfen. Checkout aufgehoben.",
           style=MB_OK | MB_ICONINFORMATION)


def _safe_discard(doc_id: str, jwt: str, draft_item_id: str | None):
    """Interne Hilfsfunktion: Sperre aufheben (alle Backends), keine Dialoge."""
    try_release_lock(doc_id, jwt)
    if draft_item_id:
        for base in backends_for(jwt):
            try:
                sp_call(jwt, {"action": "delete", "item_id": draft_item_id},
                        timeout=15, url=f"{base}/functions/v1/sharepoint-files")
                break
            except Exception:
                pass


# ── URI-Schema registrieren ───────────────────────────────────────────────────

def self_install() -> str:
    """Kopiert die laufende EXE an den festen Installationsort (INSTALL_EXE) und
    gibt dessen Pfad zurück. Nur im frozen-Modus. Läuft die EXE bereits aus dem
    Zielordner, wird nicht kopiert. Bei Fehlern wird der aktuelle Pfad
    zurückgegeben, damit die Installation trotzdem klappt."""
    if not getattr(sys, 'frozen', False):
        return sys.executable
    try:
        cur = os.path.abspath(sys.executable)
        if os.path.normcase(cur) == os.path.normcase(INSTALL_EXE):
            return INSTALL_EXE
        os.makedirs(INSTALL_DIR, exist_ok=True)
        import shutil
        shutil.copy2(cur, INSTALL_EXE)
        applog(f"self_install: kopiert {cur} -> {INSTALL_EXE}")
        return INSTALL_EXE
    except Exception as e:
        applog(f"self_install Fehler (nutze aktuellen Pfad): {e}")
        return sys.executable


def register_uri_scheme(exe_path: str | None = None) -> bool:
    """Registriert artis-open:// im Windows-Registry (HKCU)."""
    if getattr(sys, 'frozen', False):
        exe = exe_path or sys.executable
        cmd = f'"{exe}" "%1"'
    else:
        script = os.path.abspath(__file__)
        cmd    = f'"{sys.executable}" "{script}" "%1"'

    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,
                              r'Software\Classes\artis-open') as k:
            winreg.SetValue(k, '', winreg.REG_SZ, 'URL:Artis Open Protocol')
            winreg.SetValueEx(k, 'URL Protocol', 0, winreg.REG_SZ, '')
            with winreg.CreateKey(k, r'shell\open\command') as ck:
                winreg.SetValue(ck, '', winreg.REG_SZ, cmd)
        print(f"URI-Schema registriert: {cmd}")
        return True
    except Exception as e:
        print(f"Registry-Fehler: {e}")
        return False


def is_registered() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r'Software\Classes\artis-open'):
            return True
    except FileNotFoundError:
        return False


# ── Einstiegspunkt ────────────────────────────────────────────────────────────

def main():
    # Ohne URI-Argument → Installationsmodus
    if len(sys.argv) < 2 or not sys.argv[1].startswith('artis-open://'):
        installed = self_install()
        ok = register_uri_scheme(installed)
        os.makedirs(WORKSPACE, exist_ok=True)
        ensure_default_config()
        if ok:
            msgbox(
                f"Artis Agent v{APP_VERSION} wurde erfolgreich installiert.\n\n"
                f"Das Programm öffnet automatisch Dokumente aus der Artis App\n"
                f"und checkt sie nach der Bearbeitung automatisch ein.\n\n"
                f"Backend: {SUPABASE_URL}\n"
                f"(änderbar in: {CONFIG_PATH})\n\n"
                f"Installiert nach:\n{installed}\n\n"
                f"Arbeitsordner:\n{WORKSPACE}\n\n"
                f"Die heruntergeladene Datei kann jetzt gelöscht werden.",
                style=MB_OK | MB_ICONINFORMATION
            )
        else:
            msgbox(
                "Fehler bei der Installation.\n\n"
                "Bitte als Administrator ausführen oder manuell installieren.",
                style=MB_OK | MB_ICONSTOP
            )
        return

    # URI-Aufruf vom Browser
    uri = sys.argv[1]
    print(f"URI: {uri}")
    applog(f"main() URI empfangen: {uri[:90]}... | SUPABASE_URL={SUPABASE_URL}")

    try:
        parsed = urllib.parse.urlparse(uri)
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}

        action   = parsed.netloc   # z.B. 'checkout'
        doc_id   = params.get('doc_id',   '')
        jwt      = params.get('jwt',      '')
        item_id  = params.get('item_id',  '')
        filename = params.get('filename', 'dokument')

        if not doc_id or not jwt or not item_id:
            raise ValueError(
                "URI unvollständig.\nErwartet: doc_id, jwt, item_id\n\n"
                f"Erhalten: {uri[:200]}"
            )

        if action == 'checkout':
            checkout_workflow(doc_id, jwt, item_id, filename)
        else:
            raise ValueError(f"Unbekannte Aktion: '{action}'")

    except Exception as e:
        msgbox(f"Fehler beim Starten:\n\n{e}", style=MB_OK | MB_ICONSTOP)


if __name__ == '__main__':
    main()

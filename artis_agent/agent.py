"""
Artis Agent - Dokument-Manager v2.0
M-Files-Analogie: Download -> Lokal oeffnen -> Bei Schliessen zurueck hochladen
Kein SharePoint-Write, kein Draft-Upload, kein Watchdog. Einfach gehalten.
"""

import sys
import os
import time
import threading
import urllib.parse
import ctypes
import winreg
import requests

try:
    import pystray
    from pystray import MenuItem, Menu
    from PIL import Image, ImageDraw
    HAS_PYSTRAY = True
except ImportError:
    HAS_PYSTRAY = False

# Konfiguration
SUPABASE_URL      = "https://uawgpxcihixqxqxxbjak.supabase.co"
SPFILES           = f"{SUPABASE_URL}/functions/v1/sharepoint-files"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A"
WORKSPACE         = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'ArtisAgent', 'Workspace'
)
APP_NAME          = "Artis Agent"
APP_VERSION       = "2.0.0"
FILE_OPEN_TIMEOUT = 8 * 60 * 60  # 8 Stunden max

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
    return ctypes.windll.user32.MessageBoxW(0, text, title, style | MB_TOPMOST)


def resolve_token(token_id: str) -> dict:
    """Loest agent_token UUID auf -> JWT, doc_id, download_url, filename."""
    r = requests.get(
        f"{SPFILES}?action=resolve-checkout-token&token={token_id}",
        headers={"Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        timeout=15
    )
    data = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")
    return data


def download_file(url: str, dest: str):
    """Datei direkt per HTTP herunterladen (kein Auth noetig bei pre-auth URLs)."""
    r = requests.get(url, stream=True, timeout=180)
    r.raise_for_status()
    with open(dest, 'wb') as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)


def call_checkin(jwt: str, doc_id: str, local_path: str, filename: str):
    """Datei in Supabase Storage hochladen + Checkout-Sperre aufheben."""
    with open(local_path, 'rb') as f:
        file_bytes = f.read()
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}"},
        files={"file": (filename, file_bytes, "application/octet-stream")},
        data={"action": "checkin-storage", "doc_id": doc_id},
        timeout=300
    )
    data = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")
    return data


def call_discard(jwt: str, doc_id: str):
    """Checkout-Sperre aufheben ohne Upload."""
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json={"action": "checkin-discard", "doc_id": doc_id},
        timeout=15
    )
    if not r.ok:
        data = r.json() if r.content else {}
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")


def is_file_locked(path: str) -> bool:
    try:
        with open(path, 'rb+'):
            return False
    except (PermissionError, OSError):
        return True


def has_office_lockfile(path: str) -> bool:
    d = os.path.dirname(path)
    n = os.path.basename(path)
    return os.path.exists(os.path.join(d, f"~${n}"))


def is_open_by_app(path: str) -> bool:
    return is_file_locked(path) or has_office_lockfile(path)


def wait_for_file_close(path: str) -> bool:
    """Phase 1: warte bis App oeffnet (45 s). Phase 2: warte bis App schliesst (8 h)."""
    deadline = time.time() + FILE_OPEN_TIMEOUT
    opened = False
    for _ in range(45):
        if is_open_by_app(path):
            opened = True
            break
        time.sleep(1)
    if not opened:
        return True  # Nie geoeffnet = gilt als geschlossen
    while time.time() < deadline:
        if not is_open_by_app(path):
            return True
        time.sleep(2)
    return False  # Timeout


def create_icon_image():
    size = 64
    img  = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, 62, 62], fill='#1e40af')
    draw.line([(15, 52), (32, 12), (49, 52)], fill='white', width=6)
    draw.line([(22, 37), (42, 37)], fill='white', width=5)
    return img


def make_tray_icon(label, on_checkin, on_discard):
    if not HAS_PYSTRAY:
        return None
    img  = create_icon_image()
    menu = Menu(
        MenuItem(label[:45], lambda i, it: None, enabled=False),
        Menu.SEPARATOR,
        MenuItem('Jetzt einchecken',   lambda i, it: (i.stop(), on_checkin())),
        MenuItem('Checkout verwerfen', lambda i, it: (i.stop(), on_discard())),
    )
    icon = pystray.Icon(f"artis_{id(label)}", img, f"Artis: {label[:40]}", menu)
    icon.run_detached()
    return icon


def checkout_workflow(doc_id: str, jwt: str, download_url: str, filename: str):
    """M-Files-Workflow: Download -> Oeffnen -> Schliessen -> Hochladen."""
    local_path = None
    icon       = None
    done       = threading.Event()

    def log(msg):
        print(f"[{filename}] {msg}")

    try:
        os.makedirs(WORKSPACE, exist_ok=True)


        # 1. Herunterladen
        safe       = filename.replace('/', '_').replace(chr(92), '_')
        ts         = int(time.time())
        local_path = os.path.join(WORKSPACE, f"{doc_id}_{ts}_{safe}")
        # Alte Workspace-Dateien fuer dieses Dokument aufraumen
        for old in [f for f in os.listdir(WORKSPACE) if f.startswith(f"{doc_id}_")]:
            try: os.remove(os.path.join(WORKSPACE, old))
            except Exception: pass
        log(f"Herunterladen -> {local_path}")
        download_file(download_url, local_path)
        original_mtime = os.path.getmtime(local_path)

        # 2. Oeffnen
        log("Oeffnen...")
        os.startfile(local_path)

        # 3. Tray-Icon mit Sofort-Aktionen
        def tray_checkin():
            if done.is_set(): return
            done.set()
            _do_checkin(doc_id, jwt, local_path, filename)

        def tray_discard():
            if done.is_set(): return
            done.set()
            _do_discard(doc_id, jwt, filename)

        icon = make_tray_icon(filename, tray_checkin, tray_discard)

        # 4. Warten bis geschlossen
        log("Warte auf Schliessen der Datei...")
        closed = wait_for_file_close(local_path)

        if done.is_set():
            return

        if not closed:
            done.set()
            msgbox(
                f"'{filename}'\n\nBearbeitung dauerte zu lange (max. 8 h).\nCheckout wird verworfen.",
                style=MB_OK | MB_ICONWARNING
            )
            _safe_discard(doc_id, jwt)
            return

        # 5. Automatisch einchecken (kein Dialog)
        current_mtime = os.path.getmtime(local_path)
        was_modified  = abs(current_mtime - original_mtime) > 0.5

        if done.is_set(): return
        done.set()

        if was_modified:
            _do_checkin(doc_id, jwt, local_path, filename)
        else:
            _safe_discard(doc_id, jwt)

    except Exception as e:
        log(f"FEHLER: {e}")
        msgbox(f"Fehler beim Checkout von '{filename}':\n\n{e}", style=MB_OK | MB_ICONSTOP)
        if not done.is_set():
            done.set()
            _safe_discard(doc_id, jwt)

    finally:
        if icon and HAS_PYSTRAY:
            try: icon.stop()
            except Exception: pass
        if local_path and os.path.exists(local_path):
            try: os.remove(local_path)
            except Exception: pass


def _do_checkin(doc_id, jwt, local_path, filename):
    try:
        print(f"[{filename}] Einchecken in Supabase Storage...")
        call_checkin(jwt, doc_id, local_path, filename)
        msgbox(f"'{filename}'\n\nErfolgreich eingecheckt.", style=MB_OK | MB_ICONINFORMATION)
    except Exception as e:
        msgbox(
            f"Fehler beim Einchecken von '{filename}':\n\n{e}\n\n"
            "Datei bleibt lokal. Bitte manuell in der Web-App einchecken.",
            style=MB_OK | MB_ICONSTOP
        )


def _do_discard(doc_id, jwt, filename):
    _safe_discard(doc_id, jwt)
    msgbox(f"'{filename}'\n\nAenderungen verworfen. Checkout aufgehoben.",
           style=MB_OK | MB_ICONINFORMATION)


def _safe_discard(doc_id, jwt):
    try:
        call_discard(jwt, doc_id)
    except Exception as e:
        print(f"checkin-discard Fehler: {e}")


def register_uri_scheme() -> bool:
    if getattr(sys, 'frozen', False):
        exe = sys.executable
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


def main():
    if len(sys.argv) < 2 or not sys.argv[1].startswith('artis-open://'):
        ok = register_uri_scheme()
        os.makedirs(WORKSPACE, exist_ok=True)
        if ok:
            msgbox(
                f"Artis Agent v{APP_VERSION} installiert.\n\n"
                f"Dokumente werden automatisch heruntergeladen,\n"
                f"lokal geoeffnet und beim Schliessen gespeichert.\n\n"
                f"Arbeitsordner:\n{WORKSPACE}",
                style=MB_OK | MB_ICONINFORMATION
            )
        else:
            msgbox(
                "Fehler bei der Installation.\n\nBitte als Administrator ausfuehren.",
                style=MB_OK | MB_ICONSTOP
            )
        return

    uri = sys.argv[1]
    print(f"URI: {uri}")

    try:
        parsed = urllib.parse.urlparse(uri)
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        action = parsed.netloc

        token = params.get('token', '')
        if token:
            resolved     = resolve_token(token)
            doc_id       = resolved.get('doc_id', '')
            jwt          = resolved.get('jwt', '')
            download_url = resolved.get('download_url', '')
            filename     = resolved.get('filename', 'dokument')
        else:
            # Fallback alter Weg
            doc_id       = params.get('doc_id', '')
            jwt          = params.get('jwt', '')
            download_url = params.get('download_url', '')
            filename     = params.get('filename', 'dokument')

        if not doc_id or not jwt or not download_url:
            raise ValueError('URI unvollstaendig: doc_id, jwt oder download_url fehlen.')

        if action == 'checkout':
            checkout_workflow(doc_id, jwt, download_url, filename)
        else:
            raise ValueError(f"Unbekannte Aktion: '{action}'")

    except Exception as e:
        msgbox(f"Fehler beim Starten:\n\n{e}", style=MB_OK | MB_ICONSTOP)


if __name__ == '__main__':
    main()

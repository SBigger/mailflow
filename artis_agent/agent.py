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
import os
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
SUPABASE_URL = "https://uawgpxcihixqxqxxbjak.supabase.co"
SPFILES      = f"{SUPABASE_URL}/functions/v1/sharepoint-files"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A"
WORKSPACE    = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'ArtisAgent', 'Workspace'
)
APP_NAME     = "Artis Agent"
APP_VERSION  = "1.0.0"
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

def sp_call(jwt: str, body: dict, timeout: int = 30) -> dict:
    """JSON-Aufruf der sharepoint-files Edge Function."""
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout
    )
    data = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")
    return data


def sp_upload_multipart(jwt: str, action: str, doc_id: str,
                        local_path: str, filename: str,
                        extra_fields: dict | None = None,
                        timeout: int = 300) -> dict:
    """Multipart-Upload an die Edge Function (checkin-save oder upload-draft)."""
    with open(local_path, 'rb') as f:
        file_bytes = f.read()
    fields = {"action": action, "doc_id": doc_id}
    if extra_fields:
        fields.update(extra_fields)
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}"},
        files={"file": (filename, file_bytes, "application/octet-stream")},
        data=fields,
        timeout=timeout
    )
    data = r.json() if r.content else {}
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



# Checkout-Token aufloesen (Agent ruft mit ANON-Key, kein JWT im URI noetig)
def resolve_token(token_id: str) -> dict:
    """Loest ein agent_tokens UUID auf und gibt jwt, doc_id, item_id, filename zurueck."""
    r = requests.get(
        f"{SPFILES}?action=resolve-checkout-token&token={token_id}",
        headers={"Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        timeout=15
    )
    data = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(data.get('error') or f"HTTP {r.status_code}")
    return data

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

        # ── 1. Download-URL holen ────────────────────────────────────────────
        log("Hole Download-URL...")
        dl = sp_call(jwt, {"action": "get-download-url", "item_id": item_id})
        download_url = dl.get('download_url')
        if not download_url:
            raise RuntimeError("Kein Download-URL erhalten")

        # ── 2. Datei herunterladen ───────────────────────────────────────────
        safe     = filename.replace('/', '_').replace('\\', '_')
        local_path = os.path.join(WORKSPACE, f"{doc_id}_{safe}")
        log(f"Lade herunter → {local_path}")
        download_file(download_url, local_path)
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
                res = sp_upload_multipart(
                    jwt, 'upload-draft', doc_id, local_path, filename,
                    extra_fields={"prev_draft_item_id": draft_item_id[0] or ""},
                    timeout=120
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

        if was_modified:
            msg    = f"'{filename}'\n\nwurde geändert.\n\nEinchecken und neue Version speichern?"
            answer = msgbox(msg, style=MB_YESNOCANCEL | MB_ICONQUESTION)
        else:
            msg    = f"'{filename}'\n\nwurde geschlossen (keine Änderungen erkannt).\n\nCheckout aufheben?"
            answer = msgbox(msg, style=MB_YESNO | MB_ICONQUESTION)

        if done_event.is_set():
            return

        done_event.set()

        if answer == IDYES and was_modified:
            do_checkin(doc_id, jwt, local_path, filename, draft_item_id[0])
        elif answer == IDYES:
            # Keine Änderungen – nur Sperre aufheben
            _safe_discard(doc_id, jwt, draft_item_id[0])
            msgbox(f"'{filename}'\n\nCheckout aufgehoben.", style=MB_OK | MB_ICONINFORMATION)
        elif answer == IDNO:
            # Änderungen verwerfen
            do_discard(doc_id, jwt, filename, draft_item_id[0])
        # IDCANCEL → nichts tun, Datei bleibt ausgecheckt

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
    """Lädt die finale Version hoch und hebt die Sperre auf."""
    try:
        print(f"[{filename}] Einchecken...")
        sp_upload_multipart(jwt, 'checkin-save', doc_id, local_path, filename, timeout=300)
        # Draft löschen (falls vorhanden)
        if draft_item_id:
            try:
                sp_call(jwt, {"action": "delete", "item_id": draft_item_id}, timeout=15)
            except Exception:
                pass
        msgbox(f"'{filename}'\n\nErfolgreich eingecheckt ✓", style=MB_OK | MB_ICONINFORMATION)
    except Exception as e:
        msgbox(
            f"Fehler beim Einchecken von '{filename}':\n\n{e}\n\n"
            "Die Datei bleibt lokal. Bitte manuell in der Web-App einchecken.",
            style=MB_OK | MB_ICONSTOP
        )


def do_discard(doc_id: str, jwt: str, filename: str, draft_item_id: str | None):
    """Hebt die Sperre auf ohne die Datei hochzuladen."""
    _safe_discard(doc_id, jwt, draft_item_id)
    msgbox(f"'{filename}'\n\nÄnderungen verworfen. Checkout aufgehoben.",
           style=MB_OK | MB_ICONINFORMATION)


def _safe_discard(doc_id: str, jwt: str, draft_item_id: str | None):
    """Interne Hilfsfunktion: Sperre aufheben + Draft löschen, keine Dialoge."""
    try:
        sp_call(jwt, {"action": "checkin-discard", "doc_id": doc_id}, timeout=15)
    except Exception as e:
        print(f"checkin-discard Fehler: {e}")
    if draft_item_id:
        try:
            sp_call(jwt, {"action": "delete", "item_id": draft_item_id}, timeout=15)
        except Exception:
            pass


# ── URI-Schema registrieren ───────────────────────────────────────────────────

def register_uri_scheme() -> bool:
    """Registriert artis-open:// im Windows-Registry (HKCU)."""
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
        ok = register_uri_scheme()
        os.makedirs(WORKSPACE, exist_ok=True)
        if ok:
            msgbox(
                f"Artis Agent v{APP_VERSION} wurde erfolgreich installiert.\n\n"
                f"Das Programm öffnet automatisch Dokumente aus der Artis App\n"
                f"und checkt sie nach der Bearbeitung automatisch ein.\n\n"
                f"Arbeitsordner:\n{WORKSPACE}",
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

    try:
        parsed = urllib.parse.urlparse(uri)
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}

        action   = parsed.netloc   # z.B. 'checkout'
        # Neuer Weg: token=UUID im URI (kein JWT im URI, kein Windows-Corruption-Problem)
        token = params.get('token', '')
        if token:
            print(f'Token-Aufloesung: {token}')
            resolved = resolve_token(token)
            doc_id   = resolved.get('doc_id', '')
            jwt      = resolved.get('jwt', '')
            item_id  = resolved.get('item_id', '')
            filename = resolved.get('filename', 'dokument')
        else:
            # Fallback: alte Methode (JWT direkt im URI)
            doc_id   = params.get('doc_id',   '')
            jwt      = params.get('jwt',      '')
            item_id  = params.get('item_id',  '')
            filename = params.get('filename', 'dokument')

        if not doc_id or not jwt or not item_id:
            raise ValueError(
                'URI unvollstaendig: doc_id, jwt oder item_id fehlen.'
            )


        if action == 'checkout':
            checkout_workflow(doc_id, jwt, item_id, filename)
        else:
            raise ValueError(f"Unbekannte Aktion: '{action}'")

    except Exception as e:
        msgbox(f"Fehler beim Starten:\n\n{e}", style=MB_OK | MB_ICONSTOP)


if __name__ == '__main__':
    main()

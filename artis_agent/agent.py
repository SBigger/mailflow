"""
Artis Agent v2.1 - Minimal
Download -> Lokal oeffnen -> Bei Schliessen nach SharePoint hochladen.
Kein Tray-Icon, keine Bestaetigung, keine Benachrichtigungen.
"""

import sys
import os
import time
import urllib.parse
import ctypes
import winreg
import requests
import psutil

SUPABASE_URL      = "https://uawgpxcihixqxqxxbjak.supabase.co"
SPFILES           = f"{SUPABASE_URL}/functions/v1/sharepoint-files"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A"
WORKSPACE         = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "ArtisAgent", "Workspace"
)
APP_NAME          = "Artis Agent"
APP_VERSION       = "2.1.0"
FILE_OPEN_TIMEOUT = 8 * 60 * 60

MB_OK          = 0x00
MB_ICONSTOP    = 0x10
MB_TOPMOST     = 0x40000


def msgbox(text, style=MB_OK):
    ctypes.windll.user32.MessageBoxW(0, text, APP_NAME, style | MB_TOPMOST)


def resolve_token(token_id):
    r = requests.get(
        f"{SPFILES}?action=resolve-checkout-token&token={token_id}",
        headers={"Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        timeout=15
    )
    data = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(data.get("error") or f"HTTP {r.status_code}")
    return data


def download_file(url, dest):
    r = requests.get(url, stream=True, timeout=180)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)


def call_checkin(jwt, doc_id, local_path, filename):
    with open(local_path, "rb") as f:
        file_bytes = f.read()
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}"},
        files={"file": (filename, file_bytes, "application/octet-stream")},
        data={"action": "checkin-save", "doc_id": doc_id},
        timeout=300
    )
    data = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(data.get("error") or f"HTTP {r.status_code}")
    return data


def call_discard(jwt, doc_id):
    try:
        requests.post(
            SPFILES,
            headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
            json={"action": "checkin-discard", "doc_id": doc_id},
            timeout=15
        )
    except Exception:
        pass


def is_open_by_app(path):
    norm = os.path.normcase(os.path.abspath(path))
    try:
        for proc in psutil.process_iter():
            try:
                for f in proc.open_files():
                    if os.path.normcase(f.path) == norm:
                        return True
            except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
                continue
    except Exception:
        pass
    d, n = os.path.dirname(path), os.path.basename(path)
    return os.path.exists(os.path.join(d, f"~${n}"))


def wait_for_file_close(path):
    opened = False
    for _ in range(45):
        if is_open_by_app(path):
            opened = True
            break
        time.sleep(1)
    if not opened:
        return True
    deadline = time.time() + FILE_OPEN_TIMEOUT
    while time.time() < deadline:
        if not is_open_by_app(path):
            return True
        time.sleep(2)
    return False


def checkout_workflow(doc_id, jwt, download_url, filename):
    local_path = None
    try:
        safe       = filename.replace("/", "_").replace(chr(92), "_")
        ts         = int(time.time())
        local_path = os.path.join(WORKSPACE, f"{doc_id}_{ts}_{safe}")
        for old in [f for f in os.listdir(WORKSPACE) if f.startswith(f"{doc_id}_")]:
            try: os.remove(os.path.join(WORKSPACE, old))
            except Exception: pass
        download_file(download_url, local_path)
        os.startfile(local_path)
        closed = wait_for_file_close(local_path)
        if not closed:
            call_discard(jwt, doc_id)
            return
        try:
            call_checkin(jwt, doc_id, local_path, filename)
        except Exception as e:
            msgbox("Fehler beim Einchecken:\n\n" + str(e), style=MB_ICONSTOP)
    except Exception as e:
        msgbox("Fehler:\n\n" + str(e), style=MB_ICONSTOP)
        call_discard(jwt, doc_id)
    finally:
        if local_path and os.path.exists(local_path):
            try: os.remove(local_path)
            except Exception: pass


def register_uri_scheme():
    q = chr(34)
    if getattr(sys, "frozen", False):
        cmd = q + sys.executable + q + " " + q + "%1" + q
    else:
        cmd = q + sys.executable + q + " " + q + os.path.abspath(__file__) + q + " " + q + "%1" + q
    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software" + chr(92) + "Classes" + chr(92) + "artis-open") as k:
            winreg.SetValue(k, "", winreg.REG_SZ, "URL:Artis Open Protocol")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
            with winreg.CreateKey(k, r"shell\open\command") as ck:
                winreg.SetValue(ck, "", winreg.REG_SZ, cmd)
        return True
    except Exception:
        return False


def main():
    if len(sys.argv) < 2 or not sys.argv[1].startswith("artis-open://"):
        ok = register_uri_scheme()
        os.makedirs(WORKSPACE, exist_ok=True)
        if ok:
            msgbox(f"Artis Agent v{APP_VERSION} installiert.")
        else:
            msgbox("Fehler bei der Installation.\n\nBitte als Administrator ausfuehren.",
                   style=MB_ICONSTOP)
        sys.exit(0)

    try:
        parsed = urllib.parse.urlparse(sys.argv[1])
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        action = parsed.netloc

        token = params.get("token", "")
        if token:
            res          = resolve_token(token)
            doc_id       = res.get("doc_id", "")
            jwt          = res.get("jwt", "")
            download_url = res.get("download_url", "")
            filename     = res.get("filename", "dokument")
        else:
            doc_id       = params.get("doc_id", "")
            jwt          = params.get("jwt", "")
            download_url = params.get("download_url", "")
            filename     = params.get("filename", "dokument")

        if not doc_id or not jwt or not download_url:
            raise ValueError("URI unvollstaendig: doc_id, jwt oder download_url fehlen.")

        if action == "checkout":
            os.makedirs(WORKSPACE, exist_ok=True)
            if any(f.startswith(f"{doc_id}_") for f in os.listdir(WORKSPACE)):
                sys.exit(0)
            checkout_workflow(doc_id, jwt, download_url, filename)
        else:
            raise ValueError(f"Unbekannte Aktion: {action!r}")

    except Exception as e:
        msgbox("Fehler:\n\n" + str(e), style=MB_ICONSTOP)

    sys.exit(0)


if __name__ == "__main__":
    main()

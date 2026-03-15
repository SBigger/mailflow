"""
Artis Agent v4.0 - Supabase Storage Checkin (kein SharePoint-Write)
"""

import sys
import os
import time
import urllib.parse
import ctypes
import winreg
import requests

SUPABASE_URL      = "https://uawgpxcihixqxqxxbjak.supabase.co"
SPFILES           = f"{SUPABASE_URL}/functions/v1/sharepoint-files"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A"
WORKSPACE         = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "ArtisAgent", "Workspace"
)
LOG_FILE          = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "ArtisAgent", "agent.log"
)
APP_NAME      = "Artis Agent"
APP_VERSION   = "4.0.0"
POLL_INTERVAL = 3
CLOSE_TIMEOUT = 8 * 60 * 60
OPEN_WAIT     = 5
CLOSE_GRACE   = 3

MB_OK       = 0x00
MB_ICONSTOP = 0x10
MB_TOPMOST  = 0x40000

OFFICE_EXTS = {
    '.docx', '.doc', '.docm',
    '.xlsx', '.xls', '.xlsm', '.xlsb',
    '.pptx', '.ppt', '.pptm',
}


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        ts = time.strftime("%H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{ts} {msg}\n")
    except Exception:
        pass


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


def call_checkin_agent(agent_token, doc_id, local_path, filename):
    """Lädt die bearbeitete Datei direkt in Supabase Storage hoch."""
    with open(local_path, "rb") as f:
        file_bytes = f.read()
    log(f"  checkin-agent: {len(file_bytes)} bytes")
    url = f"{SPFILES}?action=checkin-agent&agent_token={agent_token}"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        files={"file": (filename, file_bytes, "application/octet-stream")},
        data={"doc_id": doc_id},
        timeout=120
    )
    data = r.json() if r.content else {}
    if not r.ok:
        err = data.get("error") or f"HTTP {r.status_code}"
        log(f"  checkin-agent FEHLER: {err}")
        raise RuntimeError(err)
    log(f"  checkin-agent OK")
    return data


def call_discard(agent_token, doc_id):
    """Gibt den Checkout frei ohne hochzuladen (keine Änderungen)."""
    log(f"  discard: doc_id={doc_id[:8]}")
    try:
        url = f"{SPFILES}?action=checkin-discard&agent_token={agent_token}"
        requests.post(
            url,
            headers={"Authorization": f"Bearer {SUPABASE_ANON_KEY}", "Content-Type": "application/json"},
            json={"doc_id": doc_id},
            timeout=15
        )
    except Exception:
        pass


def has_lockfile(path):
    d = os.path.dirname(path)
    n = os.path.basename(path)
    ext = os.path.splitext(n)[1].lower()
    if os.path.exists(os.path.join(d, "~$" + n)):
        return True
    base = os.path.splitext(n)[0]
    if len(base) > 2 and os.path.exists(os.path.join(d, "~$" + base[2:] + ext)):
        return True
    try:
        for f in os.listdir(d):
            if f.startswith("~$") and f.lower().endswith(ext):
                return True
    except Exception:
        pass
    return False


def is_file_locked(path):
    try:
        with open(path, "r+b"):
            return False
    except (IOError, OSError, PermissionError):
        return True


def is_office_file(filename):
    return os.path.splitext(filename)[1].lower() in OFFICE_EXTS


def checkout_workflow(doc_id, agent_token, download_url, filename):
    local_path = None
    log(f"=== checkout_workflow START: {filename} (doc={doc_id[:8]})")
    try:
        safe = filename.replace("/", "_").replace(chr(92), "_")
        ts = int(time.time())
        local_path = os.path.join(WORKSPACE, f"{doc_id}_{ts}_{safe}")

        for old in [f for f in os.listdir(WORKSPACE) if f.startswith(f"{doc_id}_")]:
            try:
                os.remove(os.path.join(WORKSPACE, old))
                log(f"  cleaned: {old}")
            except Exception:
                pass

        download_file(download_url, local_path)
        log(f"  downloaded: {os.path.getsize(local_path)} bytes")
        os.startfile(local_path)
        log(f"  startfile, waiting {OPEN_WAIT}s")
        time.sleep(OPEN_WAIT)

        mtime_start = os.path.getmtime(local_path) if os.path.exists(local_path) else 0
        is_office = is_office_file(filename)
        deadline = time.time() + CLOSE_TIMEOUT

        iteration = 0
        while time.time() < deadline:
            time.sleep(POLL_INTERVAL)
            iteration += 1

            if not os.path.exists(local_path):
                log(f"  iter {iteration}: gone -> break")
                break

            lf = has_lockfile(local_path)
            log(f"  iter {iteration}: lockfile={lf}")

            if is_office:
                if not lf:
                    log(f"  lockfile gone -> grace {CLOSE_GRACE}s")
                    time.sleep(CLOSE_GRACE)
                    break
            else:
                if not is_file_locked(local_path):
                    time.sleep(2)
                    if not is_file_locked(local_path):
                        break

        if os.path.exists(local_path):
            final_mtime = os.path.getmtime(local_path)
            if final_mtime != mtime_start:
                log(f"  Datei geändert -> checkin")
                call_checkin_agent(agent_token, doc_id, local_path, filename)
                log(f"  === ERFOLG: eingecheckt ===")
            else:
                log(f"  Keine Änderung -> discard")
                call_discard(agent_token, doc_id)
        else:
            log(f"  Datei weg -> discard")
            call_discard(agent_token, doc_id)

    except Exception as e:
        log(f"  EXCEPTION: {e}")
        msgbox("Fehler:\n\n" + str(e), style=MB_ICONSTOP)
        call_discard(agent_token, doc_id)
    finally:
        if local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except Exception:
                pass
        log(f"=== checkout_workflow END ===")


def register_uri_scheme():
    q = chr(34)
    if getattr(sys, "frozen", False):
        cmd = q + sys.executable + q + " " + q + "%1" + q
    else:
        cmd = (q + sys.executable + q + " " +
               q + os.path.abspath(__file__) + q + " " +
               q + "%1" + q)
    try:
        key = (r"Software" + chr(92) + "Classes" + chr(92) + "artis-open")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key) as k:
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
            msgbox("Fehler bei der Installation.\n\nBitte als Administrator ausfuehren.", style=MB_ICONSTOP)
        sys.exit(0)

    log(f"--- Agent gestartet: {' '.join(sys.argv)}")
    try:
        parsed = urllib.parse.urlparse(sys.argv[1])
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}

        token = params.get("token", "")
        if not token:
            raise ValueError("Kein token in URI")

        res          = resolve_token(token)
        doc_id       = res.get("doc_id", "")
        agent_token  = token   # token_id als agent_token für alle Folgeaufrufe
        download_url = res.get("download_url", "")
        filename     = res.get("filename", "dokument")

        log(f"  doc_id={doc_id[:8]}, filename={filename}")

        if not doc_id or not download_url:
            raise ValueError("URI unvollständig: doc_id oder download_url fehlen.")

        os.makedirs(WORKSPACE, exist_ok=True)
        checkout_workflow(doc_id, agent_token, download_url, filename)

    except Exception as e:
        log(f"  main EXCEPTION: {e}")
        msgbox("Fehler:\n\n" + str(e), style=MB_ICONSTOP)

    sys.exit(0)


if __name__ == "__main__":
    main()

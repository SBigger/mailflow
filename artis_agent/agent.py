"""
Artis Agent v3.1 - Mit Logging fuer Diagnose
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
APP_NAME          = "Artis Agent"
APP_VERSION       = "3.1.0"
POLL_INTERVAL     = 3
CLOSE_TIMEOUT     = 8 * 60 * 60
OPEN_WAIT         = 5
CLOSE_GRACE       = 3

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
        line = f"{ts} {msg}\n"
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
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


def upload_draft(jwt, doc_id, local_path, filename, prev_draft_item_id=""):
    with open(local_path, "rb") as f:
        file_bytes = f.read()
    log(f"  upload_draft: {len(file_bytes)} bytes, prev={prev_draft_item_id[:20] if prev_draft_item_id else '-'}")
    data = {"action": "upload-draft", "doc_id": doc_id}
    if prev_draft_item_id:
        data["prev_draft_item_id"] = prev_draft_item_id
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}"},
        files={"file": (filename, file_bytes, "application/octet-stream")},
        data=data,
        timeout=120
    )
    result = r.json() if r.content else {}
    if not r.ok:
        err = result.get("error") or f"HTTP {r.status_code}"
        log(f"  upload_draft FEHLER: {err}")
        raise RuntimeError(err)
    draft_id = result.get("draft_item_id", "")
    log(f"  upload_draft OK: draft_id={draft_id[:30] if draft_id else 'LEER!'}")
    return draft_id


def call_checkin_from_draft(jwt, doc_id, draft_item_id):
    log(f"  checkin-from-draft: draft_id={draft_item_id[:30]}")
    r = requests.post(
        SPFILES,
        headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
        json={"action": "checkin-from-draft", "doc_id": doc_id, "draft_item_id": draft_item_id},
        timeout=300
    )
    data = r.json() if r.content else {}
    if not r.ok:
        err = data.get("error") or f"HTTP {r.status_code}"
        log(f"  checkin-from-draft FEHLER: {err}")
        raise RuntimeError(err)
    log(f"  checkin-from-draft OK")
    return data


def call_discard(jwt, doc_id, draft_item_id=""):
    log(f"  discard: doc_id={doc_id[:8]}, draft={draft_item_id[:20] if draft_item_id else '-'}")
    try:
        payload = {"action": "checkin-discard", "doc_id": doc_id}
        if draft_item_id:
            payload["draft_item_id"] = draft_item_id
        requests.post(
            SPFILES,
            headers={"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"},
            json=payload,
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
    ext = os.path.splitext(filename)[1].lower()
    return ext in OFFICE_EXTS


def checkout_workflow(doc_id, jwt, download_url, filename):
    local_path = None
    draft_item_id = ""
    log(f"=== checkout_workflow START: {filename} (doc={doc_id[:8]})")
    try:
        safe = filename.replace("/", "_").replace(chr(92), "_")
        ts = int(time.time())
        local_path = os.path.join(WORKSPACE, f"{doc_id}_{ts}_{safe}")
        log(f"  local_path: {local_path}")

        for old in [f for f in os.listdir(WORKSPACE) if f.startswith(f"{doc_id}_")]:
            try:
                os.remove(os.path.join(WORKSPACE, old))
                log(f"  cleaned old: {old}")
            except Exception:
                pass

        download_file(download_url, local_path)
        log(f"  downloaded: {os.path.getsize(local_path)} bytes")
        os.startfile(local_path)
        log(f"  startfile done, waiting {OPEN_WAIT}s")
        time.sleep(OPEN_WAIT)

        last_mtime = os.path.getmtime(local_path) if os.path.exists(local_path) else 0
        last_draft_mtime = last_mtime
        deadline = time.time() + CLOSE_TIMEOUT
        is_office = is_office_file(filename)
        log(f"  is_office={is_office}, mtime0={last_mtime:.0f}")

        # Welche Lockfiles existieren beim Start?
        ws_files = os.listdir(WORKSPACE)
        lock_files = [f for f in ws_files if f.startswith("~$")]
        log(f"  workspace files: {ws_files}")
        log(f"  lockfiles at start: {lock_files}")

        iteration = 0
        while time.time() < deadline:
            time.sleep(POLL_INTERVAL)
            iteration += 1

            if not os.path.exists(local_path):
                log(f"  iter {iteration}: local_path gone -> break")
                break

            cur_mtime = os.path.getmtime(local_path)
            lf = has_lockfile(local_path)
            ws_now = [f for f in os.listdir(WORKSPACE) if f.startswith("~$")]
            log(f"  iter {iteration}: mtime={cur_mtime:.0f} (delta={cur_mtime-last_mtime:.0f}), lockfile={lf}, ~$files={ws_now}")

            if cur_mtime != last_mtime:
                last_mtime = cur_mtime
                try:
                    draft_item_id = upload_draft(
                        jwt, doc_id, local_path, filename, draft_item_id
                    )
                    last_draft_mtime = cur_mtime
                except Exception as e:
                    log(f"  upload_draft exception: {e}")

            if is_office:
                if not lf:
                    log(f"  lockfile gone -> grace {CLOSE_GRACE}s")
                    time.sleep(CLOSE_GRACE)
                    if os.path.exists(local_path):
                        final_mtime = os.path.getmtime(local_path)
                        log(f"  final_mtime={final_mtime:.0f}, last_draft_mtime={last_draft_mtime:.0f}")
                        if final_mtime != last_draft_mtime:
                            try:
                                draft_item_id = upload_draft(
                                    jwt, doc_id, local_path, filename, draft_item_id
                                )
                            except Exception as e:
                                log(f"  final upload_draft exception: {e}")
                    break
            else:
                if not is_file_locked(local_path):
                    time.sleep(2)
                    if not is_file_locked(local_path):
                        log(f"  not locked -> break")
                        break

        log(f"  loop ended: draft_item_id={draft_item_id[:30] if draft_item_id else 'LEER'}")

        if draft_item_id:
            try:
                call_checkin_from_draft(jwt, doc_id, draft_item_id)
                log(f"  === ERFOLG: eingecheckt ===")
            except Exception as e:
                log(f"  checkin exception: {e}")
                msgbox("Fehler beim Einchecken:\n\n" + str(e), style=MB_ICONSTOP)
        else:
            log(f"  === DISCARD: kein Draft ===")
            call_discard(jwt, doc_id)

    except Exception as e:
        log(f"  EXCEPTION: {e}")
        msgbox("Fehler:\n\n" + str(e), style=MB_ICONSTOP)
        call_discard(jwt, doc_id, draft_item_id)
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
            msgbox(
                "Fehler bei der Installation.\n\nBitte als Administrator ausfuehren.",
                style=MB_ICONSTOP
            )
        sys.exit(0)

    log(f"--- Agent gestartet: {' '.join(sys.argv)}")
    try:
        parsed = urllib.parse.urlparse(sys.argv[1])
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        action = parsed.netloc

        token = params.get("token", "")
        if token:
            res          = resolve_token(token)
            doc_id       = res.get("doc_id", "")
            jwt          = token  # token_id als Auth verwenden (user JWT laeuft nach ~1h ab)
            download_url = res.get("download_url", "")
            filename     = res.get("filename", "dokument")
        else:
            doc_id       = params.get("doc_id", "")
            jwt          = params.get("jwt", "")
            download_url = params.get("download_url", "")
            filename     = params.get("filename", "dokument")

        log(f"  action={action}, doc_id={doc_id[:8]}, filename={filename}")

        if not doc_id or not jwt or not download_url:
            raise ValueError("URI unvollstaendig: doc_id, jwt oder download_url fehlen.")

        if action == "checkout":
            os.makedirs(WORKSPACE, exist_ok=True)
            for old_f in [f for f in os.listdir(WORKSPACE) if f.startswith(f"{doc_id}_")]:
                try:
                    os.remove(os.path.join(WORKSPACE, old_f))
                except Exception:
                    pass
            checkout_workflow(doc_id, jwt, download_url, filename)
        else:
            raise ValueError(f"Unbekannte Aktion: {action!r}")

    except Exception as e:
        log(f"  main EXCEPTION: {e}")
        msgbox("Fehler:\n\n" + str(e), style=MB_ICONSTOP)

    sys.exit(0)


if __name__ == "__main__":
    main()

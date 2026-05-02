"""
Liest 'alle adressen m-files.CSV' und setzt mandatsleiter_id / sachbearbeiter_id
in bestehenden CRM-Kunden.

Nur Namen: Reto, Sascha, Romy, Maura (andere werden ignoriert).
Keine neuen Adressen werden angelegt.

Modi:
  python import_mandatsleiter.py dry   → Vorschau (kein DB-Write)
  python import_mandatsleiter.py go    → echter Import
"""

import csv, sys, json, urllib.request, urllib.error

SUPABASE_URL = "https://uawgpxcihixqxqxxbjak.supabase.co"
ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A"
CSV_PATH     = "C:/Users/SaschaBigger/Artis Treuhand GmbH/OneDrive - Artis Treuhand GmbH/Desktop/alle adressen m-files.CSV"

DRY = "go" not in sys.argv

# Erlaubte Vornamen → Matching auf Vorname (case-insensitive)
ALLOWED = {"reto", "sascha", "romy", "maura"}

def first_name(full):
    """Extrahiert Vorname aus 'Vorname Nachname'."""
    if not full:
        return None
    return full.strip().split()[0].lower() if full.strip() else None

def supa_get(path):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def supa_patch(table, row_id, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    payload = json.dumps(data).encode()
    req = urllib.request.Request(url, data=payload, method="PATCH", headers={
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req) as r:
        return r.status

# ── 1. Profile laden (UUID → Vorname) ───────────────────────────
print("Lade Profile …")
profiles = supa_get("profiles?select=id,full_name,email&limit=200")
# Map: Vorname.lower() → UUID  (nur erlaubte)
name_to_id = {}
for p in profiles:
    fn = first_name(p.get("full_name") or "")
    if fn and fn in ALLOWED:
        name_to_id[fn] = p["id"]
        print(f"  Gefunden: {fn} → {p['id']} ({p.get('full_name')})")

if not name_to_id:
    print("FEHLER: Keine Mitarbeiter in profiles gefunden!")
    sys.exit(1)

# ── 2. CRM-Kunden laden ─────────────────────────────────────────
print("\nLade CRM-Kunden …")
customers = supa_get("customers?select=id,company_name,person_type,mandatsleiter_id,sachbearbeiter_id&limit=2000")
# Index: company_name.lower() → customer
crm_index = {}
for c in customers:
    key = (c.get("company_name") or "").strip().lower()
    if key:
        crm_index[key] = c
print(f"  {len(customers)} Kunden geladen, {len(crm_index)} eindeutige Namen")

# ── 3. CSV lesen ────────────────────────────────────────────────
print(f"\nLese CSV: {CSV_PATH}")
updates = []
no_match = []
no_staff = []

with open(CSV_PATH, encoding="utf-8-sig", errors="replace") as f:
    reader = csv.DictReader(f, delimiter=";")
    for row in reader:
        klasse = (row.get("Klasse") or "").strip()
        if klasse not in ("Firmenkunde", "Privatkunde"):
            continue

        ml_raw = (row.get("MandatsleiterIn") or "").strip()
        sb_raw = (row.get("SachbearbeiterIn") or "").strip()
        if not ml_raw and not sb_raw:
            no_staff.append(row.get("Name", "?"))
            continue

        # Firmenkunde → Firmenname, Privatkunde → Name-Spalte
        if klasse == "Firmenkunde":
            name = (row.get("Firmenname") or row.get("Name") or "").strip()
        else:
            # Privatkunde: Nachname + Vorname
            nachname = (row.get("Nachname") or "").strip()
            vorname  = (row.get("Vorname") or "").strip()
            name     = (row.get("Name") or "").strip()

        # Suche im CRM
        crm = crm_index.get(name.lower())
        if not crm:
            # Fallback: nur Nachname (für Privatkunden)
            no_match.append(name)
            continue

        ml_fn = first_name(ml_raw)
        sb_fn = first_name(sb_raw)
        ml_id = name_to_id.get(ml_fn) if ml_fn in ALLOWED else None
        sb_id = name_to_id.get(sb_fn) if sb_fn in ALLOWED else None

        patch = {}
        if ml_id and crm.get("mandatsleiter_id") != ml_id:
            patch["mandatsleiter_id"] = ml_id
        if sb_id and crm.get("sachbearbeiter_id") != sb_id:
            patch["sachbearbeiter_id"] = sb_id

        if patch:
            updates.append({
                "id":   crm["id"],
                "name": name,
                "patch": patch,
                "ml_name": ml_raw,
                "sb_name": sb_raw,
            })

# ── 4. Ausgabe ──────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"Zu aktualisieren: {len(updates)}")
print(f"Kein CRM-Match:   {len(no_match)}")
print(f"Kein Staff:       {len(no_staff)}")

print("\nVORSCHAU (erste 30):")
for u in updates[:30]:
    print(f"  {u['name']:<40} ML:{u['ml_name']:<20} SB:{u['sb_name']}")

if no_match:
    print(f"\nKein Match (erste 20):")
    for n in no_match[:20]:
        print(f"  → {n}")

if DRY:
    print("\n[DRY-RUN] Kein DB-Write. Mit 'go' starten für echten Import.")
    sys.exit(0)

# ── 5. Updates schreiben ────────────────────────────────────────
print(f"\n{'='*60}")
print(f"Schreibe {len(updates)} Updates …")
ok = 0
err = 0
for u in updates:
    try:
        supa_patch("customers", u["id"], u["patch"])
        print(f"  ✓ {u['name']}")
        ok += 1
    except Exception as e:
        print(f"  ✗ {u['name']}: {e}")
        err += 1

print(f"\nFertig: {ok} OK, {err} Fehler")

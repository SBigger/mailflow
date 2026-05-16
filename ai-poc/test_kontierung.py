"""PoC Stage 2: Kontierungs-Vorschlag basierend auf extrahierten Daten.

Nimmt das Output von test_ollama.py (result_*.json) und erzeugt
einen Buchungssatz-Vorschlag mit Few-Shot-Beispielen aus Artis-Kontenrahmen.

So funktioniert RAG-light spaeter:
- Statt diesem Hardcoded-Beispielsatz kommen 5 aehnliche Buchungen
  aus der Fibu-DB (per Vector-Search)
- Modell schlaegt basierend auf dem Muster vor
"""
import json
import urllib.request
from pathlib import Path

import os

# Modell fuer Reasoning - kein Vision noetig, leichter Text-Call
MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

# Schweizer KMU-Kontenrahmen (verkuerzter Auszug)
# In Produktion: pro Kunde individuell aus Fibu-DB ziehen
KONTENRAHMEN_KMU = {
    "1020": "Bankkonto",
    "1100": "Forderungen aus Lieferungen und Leistungen",
    "1170": "Vorsteuer MWST auf Materialaufwand",
    "1171": "Vorsteuer MWST auf Investitionen und uebrigem Betriebsaufwand",
    "2000": "Verbindlichkeiten aus Lieferungen und Leistungen",
    "2200": "Geschuldete MWST",
    "4000": "Materialaufwand",
    "4400": "Bezogene Drittleistungen",
    "6000": "Raumaufwand",
    "6100": "Unterhalt, Reparaturen, Ersatz",
    "6200": "Fahrzeug- und Transportaufwand",
    "6260": "Leasing Fahrzeuge",
    "6500": "Verwaltungs- und Informatikaufwand",
    "6510": "Buero- und Verwaltungsaufwand",
    "6513": "Software-Lizenzen und SaaS",
    "6570": "Informatikaufwand (Drittleistungen)",
    "6600": "Werbeaufwand",
    "6700": "Sonstiger Betriebsaufwand",
}

# Few-Shot-Beispiele - aus realer Buchungs-Historie der Kanzlei
# In Produktion: per pgvector aehnlich-Suche aus DB
FEW_SHOT = [
    {
        "lieferant": "Microsoft Schweiz",
        "beschreibung": "Office 365 Business Standard Lizenzen",
        "betrag_brutto": 250.00,
        "mwst_satz": 8.1,
        "soll_konto": "6513",
        "haben_konto": "2000",
        "mwst_konto": "1171",
        "begruendung": "SaaS-Lizenz fuer Buero-Software -> Software-Lizenzen 6513",
    },
    {
        "lieferant": "Swisscom AG",
        "beschreibung": "Mobilfunk-Abo + Internet",
        "betrag_brutto": 89.00,
        "mwst_satz": 8.1,
        "soll_konto": "6500",
        "haben_konto": "2000",
        "mwst_konto": "1171",
        "begruendung": "Telekommunikation -> Verwaltungs- und Informatikaufwand 6500",
    },
    {
        "lieferant": "AMAG Leasing AG",
        "beschreibung": "Leasingrate VW Tiguan Maerz",
        "betrag_brutto": 850.00,
        "mwst_satz": 8.1,
        "soll_konto": "6260",
        "haben_konto": "2000",
        "mwst_konto": "1171",
        "begruendung": "Auto-Leasingrate -> Leasing Fahrzeuge 6260",
    },
]


def build_prompt(beleg: dict) -> str:
    kontenrahmen_str = "\n".join(f"  {k}: {v}" for k, v in KONTENRAHMEN_KMU.items())
    beispiele_str = "\n\n".join(
        f"BEISPIEL:\n  Lieferant: {b['lieferant']}\n  Beschreibung: {b['beschreibung']}\n"
        f"  Betrag: {b['betrag_brutto']} CHF (MWST {b['mwst_satz']}%)\n"
        f"  Buchung: {b['soll_konto']} an {b['haben_konto']} (MWST {b['mwst_konto']})\n"
        f"  -> {b['begruendung']}"
        for b in FEW_SHOT
    )

    return f"""Du bist ein erfahrener Schweizer Buchhalter. Schlage einen Buchungssatz vor.

KONTENRAHMEN (Auszug, Schweizer KMU):
{kontenrahmen_str}

ZUVOR GEBUCHTE AEHNLICHE BELEGE (Few-Shot):

{beispiele_str}

NEUER BELEG ZU BUCHEN:
  Lieferant: {beleg.get('lieferant_name')}
  Positionen: {json.dumps([p.get('beschreibung') for p in beleg.get('positionen', [])], ensure_ascii=False)}
  Betrag brutto: {beleg.get('betrag_brutto')} {beleg.get('waehrung', 'CHF')}
  MWST: {beleg.get('mwst_satz')}% = {beleg.get('mwst_betrag')}

Gib NUR JSON zurueck, GENAU dieses Format:
{{
  "soll_konto": "XXXX",
  "soll_konto_name": "...",
  "haben_konto": "2000",
  "haben_konto_name": "Verbindlichkeiten aus Lieferungen und Leistungen",
  "mwst_konto": "1171",
  "betrag_netto": 0.00,
  "betrag_mwst": 0.00,
  "begruendung": "Kurze Begruendung warum dieses Konto"
}}
"""


def call_ollama_text(prompt: str) -> tuple[dict | str, float]:
    import time
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_ctx": 8192},
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    elapsed = time.perf_counter() - t0
    response_text = body.get("response", "")
    try:
        return json.loads(response_text), elapsed
    except json.JSONDecodeError:
        return response_text, elapsed


def main() -> None:
    poc_dir = Path(__file__).parent
    result_files = sorted(poc_dir.glob("result_*.json"))
    if not result_files:
        print("Keine result_*.json gefunden. Erst test_ollama.py laufen lassen!")
        return

    print(f"Kontierungs-PoC: {len(result_files)} Belege\n")

    for rf in result_files:
        stem = rf.stem.replace("result_", "")
        beleg = json.loads(rf.read_text(encoding="utf-8"))
        print(f"=== {stem} ===")
        print(f"  Lieferant: {beleg.get('lieferant_name')}")

        prompt = build_prompt(beleg)
        try:
            vorschlag, elapsed = call_ollama_text(prompt)
        except Exception as e:
            print(f"  FEHLER: {e}\n")
            continue

        print(f"  Zeit: {elapsed:.1f}s")
        if isinstance(vorschlag, dict):
            print(f"  Soll  : {vorschlag.get('soll_konto')} {vorschlag.get('soll_konto_name')}")
            print(f"  Haben : {vorschlag.get('haben_konto')} {vorschlag.get('haben_konto_name')}")
            print(f"  MWST  : {vorschlag.get('mwst_konto')}")
            print(f"  Netto : {vorschlag.get('betrag_netto')}")
            print(f"  MWST  : {vorschlag.get('betrag_mwst')}")
            print(f"  Why   : {vorschlag.get('begruendung')}")

            out = poc_dir / f"kontierung_{stem}.json"
            out.write_text(json.dumps(vorschlag, indent=2, ensure_ascii=False), encoding="utf-8")
        else:
            print(f"  FEHLER (kein JSON): {str(vorschlag)[:200]}")
        print()


if __name__ == "__main__":
    main()

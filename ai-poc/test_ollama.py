"""PoC: Test Qwen2.5-VL on real Swiss invoices.

Pipeline:
1. Schickt jedes PNG aus belege/ an Ollama
2. Erwartet JSON mit Lieferant/Datum/Betraege/MWST/Positionen
3. Vergleicht mit Ground Truth (was wir per Auge gesehen haben)
4. Berechnet Accuracy + Zeit pro Beleg
"""
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"

PROMPT = """Du bist ein Schweizer Buchhalter mit 20 Jahren Erfahrung in der Belegerfassung.

Analysiere diesen Eingangsbeleg (Rechnung / Quittung / Leasing-Beleg) und extrahiere die Daten als JSON.

Gib NUR valides JSON zurueck, KEINE Kommentare, KEIN Markdown, mit GENAU diesen Feldern:
{
  "lieferant_name": "Firmenname des Lieferanten (NICHT der Empfaenger Artis Treuhand)",
  "lieferant_adresse": "Strasse, PLZ Ort des Lieferanten",
  "lieferant_uid": "CHE-XXX.XXX.XXX MWST oder null",
  "rechnungsnummer": "Rechnungs-Nr. / RE-Nr. / Beleg-Nr.",
  "rechnungsdatum": "TT.MM.JJJJ",
  "faelligkeitsdatum": "TT.MM.JJJJ oder null",
  "betrag_brutto": 123.45,
  "betrag_netto": 123.45,
  "mwst_satz": 8.1,
  "mwst_betrag": 12.34,
  "waehrung": "CHF",
  "iban": "CHXX XXXX XXXX XXXX XXXX X oder null",
  "qr_referenz": "Referenznummer aus QR-Rechnung oder null",
  "positionen": [
    {"beschreibung": "...", "menge": 1, "einzelpreis": 0.00, "total": 0.00}
  ]
}

REGELN:
- Schweizer MWST-Saetze 2026: 8.1% (normal), 3.8% (Beherbergung), 2.6% (reduziert/Lebensmittel), 0% (steuerfrei)
- Datum IMMER im Format TT.MM.JJJJ (nicht JJJJ-MM-TT)
- Betraege als Zahlen mit Punkt als Dezimaltrennzeichen (z.B. 1234.56), KEINE Anfuehrungszeichen, KEINE Tausendertrennzeichen
- Lieferant ist der ABSENDER der Rechnung, NICHT der Empfaenger (Artis Treuhand)
- Bei Unsicherheit: null statt raten
"""

GROUND_TRUTH = {
    "re-2026-30257": {
        "lieferant_name": "PROPbase AG",
        "rechnungsnummer": "RE-2026/30257",
        "rechnungsdatum": "30.04.2026",
        "faelligkeitsdatum": "14.05.2026",
        "betrag_brutto": 606.80,
        "betrag_netto": 561.35,
        "mwst_satz": 8.1,
        "mwst_betrag": 45.47,
        "waehrung": "CHF",
        "positionen_anzahl": 4,
    },
    "Rechnung_20260": {
        "lieferant_name": "com4all AG",
        "rechnungsnummer": "20260",
        "rechnungsdatum": "08.05.2026",
        "faelligkeitsdatum": "07.06.2026",
        "mwst_satz": 8.1,
        "waehrung": "CHF",
    },
    "1008282": {
        "lieferant_name": "Luota AG",
        "rechnungsnummer": "1008282",
        "rechnungsdatum": "30.04.2026",
        "betrag_brutto": 602.65,
        "betrag_netto": 557.50,
        "mwst_satz": 8.1,
        "mwst_betrag": 45.15,
        "waehrung": "CHF",
        "lieferant_uid": "CHE-352.115.333 MWST",
        "positionen_anzahl": 2,
    },
    "20260503172745483": {
        "lieferant_name": "BANK-now AG",
        "rechnungsdatum": "23.03.2026",
        "betrag_brutto": 895.45,
        "waehrung": "CHF",
        "lieferant_uid": "CHE-115.303.292 MWST",
    },
}


def call_ollama(image_path: Path) -> tuple[dict | str, float]:
    """Returns (parsed_dict_or_raw_string, elapsed_seconds)."""
    with open(image_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("ascii")
    payload = {
        "model": MODEL,
        "prompt": PROMPT,
        "images": [image_b64],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_ctx": 4096},
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


def compare_field(actual, expected) -> tuple[bool, str]:
    """Returns (match, formatted_diff)."""
    if expected is None:
        return True, ""
    if actual is None:
        return False, f"FEHLT (erwartet: {expected})"
    if isinstance(expected, float) and isinstance(actual, (int, float)):
        match = abs(float(actual) - float(expected)) < 0.01
    else:
        match = str(actual).strip().lower() == str(expected).strip().lower()
    icon = "OK" if match else "FAIL"
    return match, f"{icon} {actual} (erwartet: {expected})"


def evaluate(result: dict, ground_truth: dict) -> dict:
    """Compare extracted fields vs ground truth, return per-field results."""
    scoring = {}
    hits, total = 0, 0
    for field, expected in ground_truth.items():
        if field == "positionen_anzahl":
            actual = len(result.get("positionen", []))
            match, msg = compare_field(actual, expected)
        else:
            match, msg = compare_field(result.get(field), expected)
        scoring[field] = msg
        total += 1
        if match:
            hits += 1
    scoring["_score"] = f"{hits}/{total} ({100*hits//max(total,1)}%)"
    return scoring


def main() -> None:
    belege_dir = Path(__file__).parent / "belege"
    pngs = sorted(belege_dir.glob("*.png"))
    print(f"Modell: {MODEL}")
    print(f"Belege: {len(pngs)}\n")

    summary = []
    for png in pngs:
        stem = png.stem
        gt = GROUND_TRUTH.get(stem, {})
        print(f"=== {stem} ===")
        try:
            result, elapsed = call_ollama(png)
        except Exception as e:
            print(f"  FEHLER bei API-Call: {e}\n")
            summary.append((stem, 0, 0, f"Exception: {e}"))
            continue

        print(f"  Zeit: {elapsed:.1f}s")
        if not isinstance(result, dict):
            print(f"  FEHLER (kein JSON): {str(result)[:200]}")
            summary.append((stem, 0, elapsed, "Kein JSON"))
            print()
            continue

        # Save raw result
        out_json = belege_dir.parent / f"result_{stem}.json"
        out_json.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

        # Print extracted summary
        print(f"  Lieferant : {result.get('lieferant_name')}")
        print(f"  Rg-Nr     : {result.get('rechnungsnummer')}")
        print(f"  Datum     : {result.get('rechnungsdatum')}")
        print(f"  Brutto    : {result.get('betrag_brutto')} {result.get('waehrung')}")
        print(f"  MWST      : {result.get('mwst_satz')}% = {result.get('mwst_betrag')}")
        print(f"  UID       : {result.get('lieferant_uid')}")
        print(f"  Positionen: {len(result.get('positionen', []))}")

        # Evaluate against ground truth
        scoring = evaluate(result, gt)
        print(f"  --- Auswertung ---")
        for field, msg in scoring.items():
            if field.startswith("_"):
                continue
            if msg:
                print(f"  {field:25} : {msg}")
        print(f"  SCORE: {scoring.get('_score')}\n")
        summary.append((stem, scoring.get("_score"), elapsed, "OK"))

    # Final summary
    print("=" * 60)
    print("ZUSAMMENFASSUNG")
    print("=" * 60)
    for stem, score, elapsed, status in summary:
        print(f"  {stem:30} | {score:10} | {elapsed:5.1f}s | {status}")


if __name__ == "__main__":
    main()

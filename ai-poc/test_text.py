"""Der RICHTIGE Weg: PDF-Text extrahieren -> Text-LLM -> strukturiertes JSON.

Kein Bild, keine Vision, keine GPU noetig.
- Digitale PDFs: Text direkt aus PDF (Millisekunden)
- Scans: Tesseract-OCR (CPU, schnell) -> dann gleicher Text-LLM
"""
import json
import time
import urllib.request
from pathlib import Path
import fitz  # PyMuPDF

MODEL = "qwen2.5vl:3b"  # kann auch reinen Text; spaeter ggf. reines Text-Modell
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
DOWNLOADS = Path(r"C:\Users\SaschaBigger\Downloads")

FILES = ["re-2026-30257.pdf", "1008282.pdf", "Rechnung_20260.pdf", "20260503172745483.pdf"]

GROUND_TRUTH = {
    "re-2026-30257":     {"lieferant": "PROPbase AG", "nr": "RE-2026/30257", "datum": "30.04.2026", "brutto": 606.80},
    "1008282":           {"lieferant": "Luota AG",    "nr": "1008282",       "datum": "30.04.2026", "brutto": 602.65},
    "Rechnung_20260":    {"lieferant": "com4all AG",  "nr": "20260",         "datum": "08.05.2026", "brutto": None},
    "20260503172745483": {"lieferant": "BANK-now AG", "nr": None,            "datum": "23.03.2026", "brutto": 895.45},
}

PROMPT_TEMPLATE = """Du bist ein Schweizer Buchhalter. Hier ist der Text einer Eingangsrechnung.
Extrahiere die Daten als JSON. Gib NUR valides JSON zurueck.

RECHNUNGSTEXT:
---
{text}
---

WICHTIGE REGELN:
- LIEFERANT = die Firma die die Rechnung STELLT (steht im Briefkopf ganz oben,
  hat meist eine MWST-Nummer CHE-...). "Artis Treuhand GmbH" ist IMMER der
  EMPFAENGER der Rechnung, NIEMALS der Lieferant - ignoriere Artis Treuhand
  als Lieferant, auch wenn der Name in einer Leistungs-Tabelle auftaucht.
- betrag_brutto = der ENDBETRAG den man zahlt, INKLUSIVE MWST.
  Suche nach "Total inkl. MWST", "Betrag inkl. MWST", "Total inkl. MwSt",
  "Rechnungsbetrag". Das ist der GROESSTE Betrag.
- betrag_netto = Betrag OHNE MWST ("Gesamttotal", "Zwischentotal", "Total exkl.").
- betrag_brutto ist immer GROESSER als betrag_netto. Pruefe das!

Extrahiere GENAU diese Felder:
{{
  "lieferant_name": "Firma die die Rechnung stellt (NICHT Artis Treuhand)",
  "lieferant_uid": "CHE-XXX.XXX.XXX MWST oder null",
  "rechnungsnummer": "...",
  "rechnungsdatum": "TT.MM.JJJJ",
  "faelligkeitsdatum": "TT.MM.JJJJ oder null",
  "betrag_brutto": 123.45,
  "betrag_netto": 123.45,
  "mwst_satz": 8.1,
  "mwst_betrag": 12.34,
  "waehrung": "CHF",
  "positionen": [{{"beschreibung": "...", "total": 0.00}}]
}}

Betraege als Zahlen mit Punkt. Datum TT.MM.JJJJ. Bei Unsicherheit null."""


def extract_pdf_text(pdf_path: Path) -> tuple[str, str]:
    """Returns (text, method). method = 'digital' oder 'ocr' oder 'leer'."""
    doc = fitz.open(pdf_path)
    parts = []
    for page in doc:
        parts.append(page.get_text())
    doc.close()
    text = "\n".join(parts).strip()
    if len(text) > 100:
        return text, "digital"
    return text, "leer/scan"


def call_llm(prompt: str) -> tuple[dict | str, float]:
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
    with urllib.request.urlopen(req, timeout=300) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    elapsed = time.perf_counter() - t0
    txt = body.get("response", "")
    try:
        return json.loads(txt), elapsed
    except json.JSONDecodeError:
        return txt, elapsed


def check(actual, expected) -> str:
    if expected is None:
        return "  -"
    if actual is None:
        return f"FEHLT (soll: {expected})"
    if isinstance(expected, float):
        try:
            ok = abs(float(actual) - expected) < 0.01
        except (TypeError, ValueError):
            ok = False
    else:
        ok = str(actual).strip().lower() == str(expected).strip().lower()
    return ("OK   " if ok else "FALSCH") + f" {actual}" + ("" if ok else f" (soll: {expected})")


def main() -> None:
    print(f"Modell: {MODEL}  |  Methode: PDF-Text -> Text-LLM\n")
    for fname in FILES:
        pdf = DOWNLOADS / fname
        stem = pdf.stem
        gt = GROUND_TRUTH.get(stem, {})
        print(f"=== {stem} ===")

        t_ex = time.perf_counter()
        text, method = extract_pdf_text(pdf)
        ex_ms = (time.perf_counter() - t_ex) * 1000
        print(f"  Textextraktion: {ex_ms:.0f} ms  ({method}, {len(text)} Zeichen)")

        if method == "leer/scan":
            print(f"  -> SCAN, kein eingebetteter Text. Braucht OCR (separat getestet).\n")
            continue

        try:
            result, elapsed = call_llm(PROMPT_TEMPLATE.format(text=text))
        except Exception as e:
            print(f"  FEHLER LLM: {e}\n")
            continue

        print(f"  LLM-Zeit: {elapsed:.1f}s")
        if isinstance(result, dict):
            print(f"  Lieferant : {check(result.get('lieferant_name'), gt.get('lieferant'))}")
            print(f"  Rg-Nummer : {check(result.get('rechnungsnummer'), gt.get('nr'))}")
            print(f"  Datum     : {check(result.get('rechnungsdatum'), gt.get('datum'))}")
            print(f"  Brutto    : {check(result.get('betrag_brutto'), gt.get('brutto'))}")
            print(f"  MWST-Satz : {result.get('mwst_satz')}  |  UID: {result.get('lieferant_uid')}")
            print(f"  Positionen: {len(result.get('positionen', []))}")
            out = Path(__file__).parent / f"text_result_{stem}.json"
            out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        else:
            print(f"  Kein JSON: {str(result)[:200]}")
        print()


if __name__ == "__main__":
    main()

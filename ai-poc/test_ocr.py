"""OCR-Weg fuer gescannte Belege (kein Textlayer).

Pipeline:
1. PDF-Seite -> PNG (300 DPI, OCR mag hohe Aufloesung)
2. Tesseract OCR (deutsch) -> Rohtext
3. Rohtext -> Text-LLM -> strukturiertes JSON

Tesseract laeuft auf CPU und ist schnell (~1-3s pro Seite).
"""
import json
import subprocess
import time
import urllib.request
from pathlib import Path
import fitz  # PyMuPDF

MODEL = "qwen2.5vl:3b"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
TESSDATA = str(Path(__file__).parent / "tessdata")

DOWNLOADS = Path(r"C:\Users\SaschaBigger\Downloads")
SCAN_PDF = DOWNLOADS / "20260503172745483.pdf"  # BANK-now Leasing, gescannt

GROUND_TRUTH = {"lieferant": "BANK-now AG", "datum": "23.03.2026", "brutto": 895.45}

PROMPT_TEMPLATE = """Du bist ein Schweizer Buchhalter. Hier ist OCR-Text einer gescannten Rechnung.
Der Text kann OCR-Fehler enthalten. Extrahiere die Daten als JSON, gib NUR JSON zurueck.

OCR-TEXT:
---
{text}
---

WICHTIG:
- LIEFERANT = Firma die die Rechnung stellt (Briefkopf oben, mit MWST-Nr CHE-...).
  "Artis Treuhand GmbH" ist IMMER der Empfaenger, NIE der Lieferant.
- betrag_brutto = Endbetrag inkl. MWST (groesster Betrag, oft beim Einzahlungsschein).

Felder:
{{
  "lieferant_name": "...",
  "lieferant_uid": "CHE-... oder null",
  "rechnungsnummer": "... oder null",
  "rechnungsdatum": "TT.MM.JJJJ",
  "betrag_brutto": 123.45,
  "waehrung": "CHF",
  "iban": "CHXX... oder null",
  "qr_referenz": "Referenznummer oder null"
}}
Betraege als Zahlen mit Punkt. Datum TT.MM.JJJJ. Bei Unsicherheit null."""


def pdf_to_png(pdf_path: Path, dpi: int = 300) -> Path:
    doc = fitz.open(pdf_path)
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    out = Path(__file__).parent / "belege" / f"{pdf_path.stem}_ocr.png"
    out.parent.mkdir(exist_ok=True)
    pix.save(out)
    doc.close()
    return out


def ocr(png_path: Path) -> tuple[str, float]:
    t0 = time.perf_counter()
    result = subprocess.run(
        [TESSERACT, str(png_path), "stdout", "-l", "deu", "--tessdata-dir", TESSDATA],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    elapsed = time.perf_counter() - t0
    return result.stdout, elapsed


def call_llm(prompt: str) -> tuple[dict | str, float]:
    payload = {
        "model": MODEL, "prompt": prompt, "stream": False,
        "format": "json", "options": {"temperature": 0.1, "num_ctx": 8192},
    }
    req = urllib.request.Request(
        OLLAMA_URL, data=json.dumps(payload).encode("utf-8"),
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


def main() -> None:
    print(f"OCR-Test: {SCAN_PDF.name}\n")

    png = pdf_to_png(SCAN_PDF)
    print(f"1. PDF -> PNG (300 DPI): {png.name}")

    text, ocr_time = ocr(png)
    print(f"2. Tesseract OCR: {ocr_time:.1f}s, {len(text.strip())} Zeichen erkannt")
    print(f"   --- OCR-Rohtext (gekuerzt) ---")
    preview = " | ".join(line.strip() for line in text.splitlines() if line.strip())[:500]
    print(f"   {preview}\n")

    print("3. Text -> LLM ...")
    result, llm_time = call_llm(PROMPT_TEMPLATE.format(text=text))
    print(f"   LLM-Zeit: {llm_time:.1f}s")

    if isinstance(result, dict):
        gt = GROUND_TRUTH
        def chk(a, e):
            if e is None:
                return f"{a}"
            if a is None:
                return f"FEHLT (soll: {e})"
            if isinstance(e, float):
                try:
                    ok = abs(float(a) - e) < 0.01
                except (TypeError, ValueError):
                    ok = False
            else:
                ok = str(a).strip().lower() == str(e).strip().lower()
            return ("OK   " if ok else "FALSCH ") + f"{a}" + ("" if ok else f" (soll: {e})")
        print(f"\n   Lieferant : {chk(result.get('lieferant_name'), gt['lieferant'])}")
        print(f"   Datum     : {chk(result.get('rechnungsdatum'), gt['datum'])}")
        print(f"   Brutto    : {chk(result.get('betrag_brutto'), gt['brutto'])}")
        print(f"   IBAN      : {result.get('iban')}")
        print(f"   QR-Referenz: {result.get('qr_referenz')}")
        out = Path(__file__).parent / "ocr_result_bank-now.json"
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        print(f"   Kein JSON: {str(result)[:300]}")


if __name__ == "__main__":
    main()

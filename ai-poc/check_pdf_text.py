"""Pruefen ob die PDFs eine Textebene haben (digital) oder Scans sind.

Digitale PDFs -> Text direkt extrahierbar, KEIN OCR, KEINE GPU noetig.
Scans       -> nur Bild, brauchen OCR.
"""
from pathlib import Path
import fitz  # PyMuPDF

DOWNLOADS = Path(r"C:\Users\SaschaBigger\Downloads")
FILES = [
    "re-2026-30257.pdf",
    "20260503172745483.pdf",
    "1008282.pdf",
    "Rechnung_20260.pdf",
]

for fname in FILES:
    pdf = DOWNLOADS / fname
    if not pdf.exists():
        print(f"FEHLT: {fname}")
        continue
    doc = fitz.open(pdf)
    page = doc[0]
    text = page.get_text()
    n_chars = len(text.strip())
    n_images = len(page.get_images())
    typ = "DIGITAL (Textebene)" if n_chars > 100 else "SCAN (nur Bild)"
    print(f"\n=== {fname} ===")
    print(f"  Seiten      : {doc.page_count}")
    print(f"  Text-Zeichen: {n_chars}")
    print(f"  Bilder      : {n_images}")
    print(f"  TYP         : {typ}")
    if n_chars > 100:
        preview = text.strip()[:400].replace("\n", " | ")
        print(f"  Vorschau    : {preview}")
    doc.close()

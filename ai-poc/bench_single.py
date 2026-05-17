"""Benchmark: ein einzelner Bild-Call, verschiedene Aufloesungen.

Findet heraus wie lange Vision-Inferenz auf diesem Rechner dauert
und ab welcher Bildgroesse es brauchbar wird.
"""
import base64
import json
import time
import urllib.request
from pathlib import Path
import fitz  # PyMuPDF

MODEL = "qwen2.5vl:3b"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
PDF = Path(r"C:\Users\SaschaBigger\Downloads\1008282.pdf")  # Luota-Rechnung

SHORT_PROMPT = "Extrahiere als JSON: lieferant_name, rechnungsnummer, betrag_brutto, mwst_satz. Nur JSON."


def render(pdf_path: Path, dpi: int) -> bytes:
    doc = fitz.open(pdf_path)
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    data = pix.tobytes("png")
    doc.close()
    return data


def call(image_bytes: bytes, timeout: int) -> tuple[str, float]:
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": MODEL,
        "prompt": SHORT_PROMPT,
        "images": [image_b64],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1},
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    elapsed = time.perf_counter() - t0
    return body.get("response", ""), elapsed


def main() -> None:
    for dpi in [100, 130, 150]:
        img = render(PDF, dpi)
        kb = len(img) // 1024
        print(f"\n=== DPI {dpi} ({kb} KB PNG) ===")
        try:
            response, elapsed = call(img, timeout=900)
            print(f"  Zeit: {elapsed:.1f}s")
            print(f"  Antwort: {response[:300]}")
        except Exception as e:
            print(f"  FEHLER: {e}")


if __name__ == "__main__":
    main()

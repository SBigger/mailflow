"""Convert PDF (first page) to PNG for Ollama vision testing."""
import sys
from pathlib import Path
import fitz  # PyMuPDF

def convert(pdf_path: Path, out_dir: Path, dpi: int = 200) -> Path:
    doc = fitz.open(pdf_path)
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    out_path = out_dir / f"{pdf_path.stem}.png"
    pix.save(out_path)
    doc.close()
    return out_path

if __name__ == "__main__":
    downloads = Path(r"C:\Users\SaschaBigger\Downloads")
    out_dir = Path(__file__).parent / "belege"
    out_dir.mkdir(exist_ok=True)

    files = [
        "re-2026-30257.pdf",
        "20260503172745483.pdf",
        "1008282.pdf",
        "Rechnung_20260.pdf",
    ]
    for fname in files:
        pdf = downloads / fname
        if not pdf.exists():
            print(f"FEHLT: {pdf}")
            continue
        png = convert(pdf, out_dir)
        print(f"OK: {png.name} ({png.stat().st_size // 1024} KB)")

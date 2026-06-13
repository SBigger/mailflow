from flask import Flask, request, jsonify
import pytesseract
from PIL import Image
import io
import subprocess
from pdf2image import convert_from_bytes
from striprtf.striprtf import rtf_to_text

app = Flask(__name__)

@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"}), 200

@app.route("/ocr", methods=["POST"])
def ocr():
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400

    file = request.files["file"]
    filename = file.filename.lower()
    file_bytes = file.read()
    full_text = ""

    try:
        # 1. FALL: ALTES WORD-FORMAT (.doc)
        if filename.endswith(".doc") or file.content_type == "application/msword":
            try:
                process = subprocess.Popen(["catdoc", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                stdout, stderr = process.communicate(input=file_bytes, timeout=10)
                if process.returncode == 0:
                    full_text = stdout.decode("utf-8", errors="ignore")
                else:
                    raise Exception(stderr.decode("utf-8", errors="ignore"))
            except Exception as doc_err:
                print(f"Catdoc fehlgeschlagen: {doc_err}")
                full_text = "".join([chr(b) if 32 <= b < 127 or b in [10, 13] else " " for b in file_bytes])
                full_text = " ".join(full_text.split())

        # 2. FALL: RICH TEXT (.rtf)
        elif filename.endswith(".rtf"):
            try:
                full_text = rtf_to_text(file_bytes.decode("utf-8", errors="ignore"))
            except:
                full_text = file_bytes.decode("utf-8", errors="ignore")

        # 3. FALL: SCAN-PDFs
        elif filename.endswith(".pdf") or file.content_type == "application/pdf":
            images = convert_from_bytes(file_bytes)
            for image in images:
                text = pytesseract.image_to_string(image, lang="deu")
                full_text += f"{text}\n"

        # 4. FALL: NORMALE BILDER
        else:
            img = Image.open(io.BytesIO(file_bytes))
            full_text = pytesseract.image_to_string(img, lang="deu")

        return jsonify({"text": full_text.strip()})

    except Exception as e:
        return jsonify({"text": f"[OCR Fehler beim Verarbeiten der Datei: {str(e)}]"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80)
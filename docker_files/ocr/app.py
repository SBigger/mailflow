from flask import Flask, request, jsonify
import pytesseract
from PIL import Image
import io
import re
from pdf2image import convert_from_bytes
from striprtf.striprtf import rtf_to_text
import os

app = Flask(__name__)

SHARED_SECRET = os.environ.get("OCR_SHARED_SECRET")

@app.before_request
def security_check():
    if request.path in ["/", "/health"]:
        return

    client_secret = request.headers.get("X-Shared-Secret")
    if not SHARED_SECRET or client_secret != SHARED_SECRET:
        return jsonify({"error": "Unauthorized"}), 401

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

    is_old_word = file_bytes.startswith(b'\xd0\xcf\x11\xe0')
    is_pdf = file_bytes.startswith(b'%PDF')
    is_rtf = file_bytes.startswith(b'{\\rtf')
    tesseract_config = "--psm 3 --oem 1"

    try:
        if is_old_word or filename.endswith(".doc") or file.content_type == "application/msword":
            text_blocks = re.findall(b'[\x20-\x7E\x80-\xFF]{4,}', file_bytes)
            decoded_parts = []
            for block in text_blocks:
                try:
                    decoded = block.decode('utf-8', errors='ignore').strip()
                    if decoded and not decoded.startswith(('Word.Document', 'Root Entry', 'ObjectPool', 'Current User')):
                        decoded_parts.append(decoded)
                except:
                    continue
            full_text = "\n".join(decoded_parts)

        elif is_rtf or filename.endswith(".rtf"):
            try:
                full_text = rtf_to_text(file_bytes.decode("utf-8", errors="ignore"))
            except:
                full_text = file_bytes.decode("utf-8", errors="ignore")

        elif is_pdf or filename.endswith(".pdf") or file.content_type == "application/pdf":
            images = convert_from_bytes(file_bytes)
            for image in images:
                if image.width > 2000:
                    scale_factor = 2000 / float(image.width)
                    new_height = int((float(image.height) * float(scale_factor)))
                    image = image.resize((2000, new_height), Image.Resampling.LANCZOS)
                text = pytesseract.image_to_string(image, lang="deu", config=tesseract_config)
                full_text += f"{text}\n"

        else:
            img = Image.open(io.BytesIO(file_bytes))
            if img.width > 2000:
                scale_factor = 2000 / float(img.width)
                new_height = int((float(image.height) * float(scale_factor)))
                img = img.resize((2000, new_height), Image.Resampling.LANCZOS)
            full_text = pytesseract.image_to_string(img, lang="deu", config=tesseract_config)

        return jsonify({"text": full_text.strip()})

    except Exception as e:
        return jsonify({"text": f"[OCR Fehler beim Verarbeiten der Datei: {str(e)}]"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80)
FROM python:3.11-slim

# Verhindert interaktive Rückfragen und minimiert Paket-Overhead
ENV DEBIAN_FRONTEND=noninteractive

# Installiert Pakete ohne empfohlene Zusatzpakete (--no-install-recommends)
# und bereinigt den apt-Cache in derselben Zeile, um Speicherplatz zu sparen
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-deu \
    libglib2.0-0 \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Installiert Python-Pakete ohne Cache-Speicherung
RUN pip install --no-cache-dir flask pytesseract pillow pdf2image

# Erstelle das robuste API-Skript inklusive HEALTHCHECK-Routen
RUN echo 'from flask import Flask, request, jsonify\n\
import pytesseract\n\
from PIL import Image\n\
import io\n\
from pdf2image import convert_from_bytes\n\
\n\
app = Flask(__name__)\n\
\n\
@app.route("/", methods=["GET"])\n\
@app.route("/health", methods=["GET"])\n\
def health():\n\
    return jsonify({"status": "healthy"}), 200\n\
\n\
@app.route("/ocr", methods=["POST"])\n\
def ocr():\n\
    if "file" not in request.files: \n\
        return jsonify({"error": "No file"}), 400\n\
    \n\
    file = request.files["file"]\n\
    file_bytes = file.read()\n\
    full_text = ""\n\
    \n\
    try:\n\
        if file.filename.lower().endswith(".pdf") or file.content_type == "application/pdf":\n\
            images = convert_from_bytes(file_bytes)\n\
            for i, image in enumerate(images):\n\
                text = pytesseract.image_to_string(image, lang="deu")\n\
                full_text += f"{text}\\n"\n\
        else:\n\
            img = Image.open(io.BytesIO(file_bytes))\n\
            full_text = pytesseract.image_to_string(img, lang="deu")\n\
            \n\
        return jsonify({"text": full_text})\n\
    except Exception as e:\n\
        return jsonify({"error": str(e)}), 500\n\
\n\
if __name__ == "__main__": \n\
    app.run(host="0.0.0.0", port=80)\n\
' > /app.py

EXPOSE 80
CMD ["python", "/app.py"]
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# Installiere alle nötigen Linux-Tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-deu \
    libglib2.0-0 \
    poppler-utils \
    catdoc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Installiere die Python-Bibliotheken
RUN pip install --no-cache-dir flask pytesseract pillow pdf2image striprtf pypdf

# NEU & SAUBER: Kopiere die app.py direkt in den Container
COPY ./docker_files/ocr/app.py /app.py

EXPOSE 80
CMD ["python", "/app.py"]
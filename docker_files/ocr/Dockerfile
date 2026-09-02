# --- Stage 1: Build dependencies ---
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build tools if required by any pip packages (hier vermutlich nicht zwingend nötig, aber sicherheitshalber)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages into a specific directory
COPY ./docker_files/ocr/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install \
    flask \
    pytesseract \
    pillow \
    pdf2image \
    striprtf \
    pypdf \
    gunicorn


# --- Stage 2: Final lightweight image ---
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install only runtime system dependencies (Tesseract, Poppler, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-deu \
    libglib2.0-0 \
    poppler-utils \
    catdoc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copy installed python packages from builder stage
COPY --from=builder /install /usr/local

# Copy application file
COPY ./docker_files/ocr/app.py /app.py

EXPOSE 80

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:80", "app:app", "--timeout", "120"]
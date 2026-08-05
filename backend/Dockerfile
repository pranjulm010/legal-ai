FROM python:3.11-slim

# tesseract-ocr: OCR for pytesseract. poppler-utils: PDF->image for pdf2image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the embedding model into the image at build time so the app can run
# fully offline at startup (settings.py defaults HF_HUB_OFFLINE=1 to avoid
# slow/failing HuggingFace Hub calls on every request).
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python -c \
    "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD python manage.py migrate --noinput && \
    gunicorn legal_ai.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 120

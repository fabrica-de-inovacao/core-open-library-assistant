# Suporte nativo a ARM64 (Oracle A1 Ampere) e AMD64 (x86-64)
FROM python:3.11-slim

# Dependências de sistema para OCR e renderização de PDF
# tesseract-ocr-por + eng: modelos de idioma para o corpus do SOL (pt-BR + artigos em inglês)
# poppler-utils: necessário para pdf2image (pdftoppm)
# gcc + libffi: necessários para compilar algumas dependências Python em ARM64
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-por \
    tesseract-ocr-eng \
    poppler-utils \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia requirements separado do código para aproveitar cache de camadas Docker.
# Se só o código mudar (não requirements.txt), pip install não re-executa.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8917

# Variáveis de ambiente configuráveis via docker-compose / env file:
#   WORKERS                  — número de processos uvicorn (padrão: 4 para Oracle A1)
#   EXTRACTION_WORKERS       — processos no ProcessPoolExecutor para CPU-bound (padrão: CPU_WORKERS)
#   MAX_CONCURRENT_EXTRACTIONS — semáforo de backpressure (padrão: 2 × EXTRACTION_WORKERS)
#   OCR_PAGE_CHUNK_SIZE      — páginas por chunk no OCR (padrão: 10)
#   WORKER_API_KEY           — token de autenticação
#   ENABLE_ARQ_WORKER        — quando "1", também inicia o worker Redis v2
#   WORKER_PORT              — porta HTTP interna (padrão: 8917)
CMD ["sh", "-c", "if [ \"${ENABLE_ARQ_WORKER:-0}\" = \"1\" ]; then python queue_worker.py & fi; uvicorn main:app --host 0.0.0.0 --port ${WORKER_PORT:-8917} --workers ${WORKERS:-1}"]

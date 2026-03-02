FROM python:3.11-slim

# Instalação das dependências do Sistema Operativo (Crucial para o OCR e PDFs)
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-por \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# markitdown[pdf] puxa onnxruntime (CPU). Removemos e instalamos a versão GPU,
# que faz fallback automático para CPU quando CUDA não estiver disponível.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y onnxruntime 2>/dev/null || true \
    && pip install --no-cache-dir onnxruntime-gpu

COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

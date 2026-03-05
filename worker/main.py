"""
SOL Extractor Worker — FastAPI
==============================

Padrões de escalabilidade aplicados:

  1. ProcessPoolExecutor para CPU-bound (PyMuPDF, Tesseract).
     CPU-bound em asyncio handler bloqueia o event loop inteiro do processo —
     zero outras requisições são atendidas durante a extração. Processos separados
     com run_in_executor liberam o loop imediatamente.
     Ref: FastAPI docs / Starlette architecture / asyncio PEP 3156.

  2. httpx.AsyncClient como singleton via lifespan.
     Criar um cliente por request reprecia pool TCP + TLS handshake a cada
     chamada. Singleton compartilhado reutiliza conexões keep-alive.
     Ref: httpx docs — "Client as a context manager" anti-pattern.

  3. asyncio.Semaphore para backpressure das extrações.
     Sem limite, um burst de 50 requests dispara 50 PyMuPDF + OCR simultâneos,
     saturando todos os cores sem entregar nenhum resultado rapidamente.
     Semaphore garante que no máximo N extrações concorrem por vez.

  4. OCR paginado (chunk por chunk) — controle de memória RAM.
     convert_from_bytes() sem paginação carrega TODAS as páginas em memória
     (~150-300 MB por PDF de 200 páginas @300dpi). Com 4 workers = risco de OOM.
     Offset via first_page/last_page mantém footprint em ~15-30 MB por chunk.

  5. PyMuPDF com try/finally — sem memory leak.
     fitz aloca páginas em memória nativa C. Sem doc.close(), o GC do Python
     não libera — leak permanente por request.

  6. request_id por request — correlação de logs distribuídos.
     Com múltiplos workers Uvicorn e Inngest disparando em paralelo, logs sem
     ID de rastreamento são impossíveis de correlacionar em produção.

  7. Remoção de MarkItDown (dead code + RAM desperdiçada).
     MarkItDown usa pdfminer.six que falha com fontes LaTeX Type1/Type3
     (corpus predominante do SOL/SBC). PyMuPDF (MuPDF em C) decodifica
     corretamente. MarkItDown nunca era chamado no fluxo real — só ocupava
     RAM no startup via ONNX lazy-load.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from typing import Annotated, Optional

import fitz  # PyMuPDF
import httpx
import pytesseract
from bs4 import BeautifulSoup
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pdf2image import convert_from_bytes
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging estruturado
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s | %(message)s",
)
logger = logging.getLogger("sol.worker")

# ---------------------------------------------------------------------------
# Configuração via variáveis de ambiente
# ---------------------------------------------------------------------------
API_KEY: str = os.getenv("WORKER_API_KEY", "your_secret_worker_key_here")

# Processos separados para extração CPU-bound.
# Oracle A1 (4 vCPU) → 4 processos. Ajustável para ambientes menores.
CPU_WORKERS: int = int(os.getenv("EXTRACTION_WORKERS", str(os.cpu_count() or 2)))

# Máximo de extrações simultâneas aceitas (backpressure).
# Regra de ouro: 2× CPU_WORKERS — deixa margem de I/O para downloads.
MAX_CONCURRENT_EXTRACTIONS: int = int(
    os.getenv("MAX_CONCURRENT_EXTRACTIONS", str(CPU_WORKERS * 2))
)

# Páginas por chunk no OCR. 10 páginas @300dpi ≈ 15-30 MB por chunk.
OCR_PAGE_CHUNK_SIZE: int = int(os.getenv("OCR_PAGE_CHUNK_SIZE", "10"))


# ---------------------------------------------------------------------------
# Estado global (inicializado no lifespan — loop de eventos já ativo)
# ---------------------------------------------------------------------------
_http_client: httpx.AsyncClient
_cpu_executor: ProcessPoolExecutor
_extraction_semaphore: asyncio.Semaphore


# ---------------------------------------------------------------------------
# Lifespan: cria e destrói recursos compartilhados uma única vez por processo.
# Substitui os deprecated @app.on_event("startup"/"shutdown").
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(application: FastAPI):
    global _http_client, _cpu_executor, _extraction_semaphore

    logger.info(
        f"[lifespan] Iniciando worker | CPU_WORKERS={CPU_WORKERS}"
        f" | MAX_CONCURRENT={MAX_CONCURRENT_EXTRACTIONS}"
        f" | OCR_CHUNK={OCR_PAGE_CHUNK_SIZE}"
    )

    # Cliente HTTP singleton — pool de conexões reutilizadas entre requests
    _http_client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0),
        headers={"User-Agent": "SOLAssistant/1.0 (extractor-worker)"},
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
    )

    # Pool de processos para CPU-bound (PyMuPDF, Tesseract)
    _cpu_executor = ProcessPoolExecutor(max_workers=CPU_WORKERS)

    # Semáforo de backpressure: no máximo N extrações concorrentes por processo
    _extraction_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXTRACTIONS)

    logger.info("[lifespan] Recursos prontos — worker online")
    yield

    logger.info("[lifespan] Encerrando recursos...")
    await _http_client.aclose()
    _cpu_executor.shutdown(wait=False)
    logger.info("[lifespan] Encerrado")


app = FastAPI(title="SOL Extractor Worker", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Modelos Pydantic
# ---------------------------------------------------------------------------
class ExtractRequest(BaseModel):
    article_url: str
    force_ocr: bool = False


class ExtractResponse(BaseModel):
    success: bool
    method_used: str
    content_markdown: str
    char_count: int
    request_id: str


# ---------------------------------------------------------------------------
# Autenticação
# ---------------------------------------------------------------------------
def verify_token(x_worker_token: Annotated[str, Header()]) -> None:
    if x_worker_token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Worker Token")


# ---------------------------------------------------------------------------
# Funções CPU-bound — DEVEM ser top-level (pickle para ProcessPoolExecutor)
# Closures e lambdas não são serializáveis pelo multiprocessing.
# ---------------------------------------------------------------------------

def _pymupdf_extract(pdf_bytes: bytes) -> str:
    """
    Extração primária via PyMuPDF (MuPDF em C).

    Escolha deliberada sobre pdfminer/MarkItDown: o corpus do SOL é composto
    por artigos gerados em LaTeX com fontes Type1/Type3. O pdfminer não decodifica
    essas fontes corretamente — produz caracteres corrompidos (ﬁ, ﬀ, →).
    MuPDF/PyMuPDF decodifica corretamente e é ~5-10x mais rápido (C vs Python puro).

    try/finally: fitz aloca páginas em memória nativa C — sem close(), leak permanente.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return "\n".join(page.get_text("text") for page in doc)
    finally:
        doc.close()


def _ocr_extract_chunked(pdf_bytes: bytes, chunk_size: int) -> str:
    """
    OCR via Tesseract com processamento paginado.

    Por que chunked: convert_from_bytes() sem paginação carrega todas as páginas
    do PDF em memória como imagens PIL (~150-300 MB para 200 páginas @300dpi).
    Com 4 workers simultâneos no Oracle A1, isso pode esgotar os 24 GB de RAM.

    Solução: first_page/last_page processa N páginas por vez — footprint fixo
    de ~15-30 MB por chunk, independente do tamanho total do PDF.

    Tesseract: usa PyMuPDF para contar páginas (mais rápido que abrir com pdf2image
    só para isso).
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        total_pages = doc.page_count
    finally:
        doc.close()

    text_parts: list[str] = []
    for start in range(1, total_pages + 1, chunk_size):
        end = min(start + chunk_size - 1, total_pages)
        images = convert_from_bytes(
            pdf_bytes,
            dpi=300,
            first_page=start,
            last_page=end,
            fmt="jpeg",
        )
        for image in images:
            text_parts.append(pytesseract.image_to_string(image, lang="por+eng"))
        del images  # libera chunk antes do próximo

    return "\n".join(text_parts)


# ---------------------------------------------------------------------------
# Helpers de rede (async — rodam no event loop principal)
# ---------------------------------------------------------------------------

async def _download_pdf(url: str) -> bytes:
    """Download do PDF com timeout configurado no cliente singleton."""
    response = await _http_client.get(url)
    response.raise_for_status()
    return response.content


async def _resolve_pdf_url(landing_page_url: str) -> Optional[str]:
    """
    Resolve a URL real do PDF a partir de uma landing page OJS.
    Retorna None se não encontrar link direto (type hint correto — era str antes).
    """
    try:
        response = await _http_client.get(landing_page_url)
    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError):
        return None

    if not response.is_success:
        return None

    soup = BeautifulSoup(response.text, "html.parser")
    pdf_tag = soup.find("a", class_=re.compile("pdf")) or soup.find(
        "a", href=re.compile(r"/download/|/view/")
    )

    if pdf_tag and pdf_tag.get("href"):
        return str(pdf_tag["href"]).replace("/view/", "/download/")  # type: ignore[union-attr]

    return None


async def _scrape_abstract(url: str) -> str:
    """Fallback final: extrai o abstract da página HTML do artigo."""
    try:
        response = await _http_client.get(url)
        if not response.is_success:
            return "Falha ao recuperar o abstract da página."
        soup = BeautifulSoup(response.text, "html.parser")
        section = soup.find("section", class_="item abstract")
        if section:
            return section.get_text(strip=True)
        return "Abstract não encontrado na página."
    except Exception:
        return "Falha ao recuperar o abstract da página."


# ---------------------------------------------------------------------------
# Core de extração: offload CPU → ProcessPoolExecutor
# ---------------------------------------------------------------------------

async def _run_extraction(
    pdf_bytes: bytes,
    force_ocr: bool,
    request_id: str,
) -> tuple[str, str]:
    """
    Executa a extração no ProcessPoolExecutor, liberando o event loop asyncio.

    Por que ProcessPoolExecutor e não ThreadPoolExecutor:
      • CPU-bound com GIL ativo → threads não ganham paralelismo real em Python
      • Processos separados → cada um tem seu próprio GIL → paralelismo real
      • FastAPI e Starlette recomendam explicitamente processos para CPU-bound

    O asyncio.Semaphore controla quantas extrações entram no pool por vez,
    evitando que todos os CPU_WORKERS fiquem ocupados ao mesmo tempo e
    deixando margem para I/O de download de outros requests.
    """
    loop = asyncio.get_running_loop()

    async with _extraction_semaphore:
        if force_ocr:
            logger.info(f"[{request_id}] OCR forçado (chunked | chunk={OCR_PAGE_CHUNK_SIZE})")
            text = await loop.run_in_executor(
                _cpu_executor, _ocr_extract_chunked, pdf_bytes, OCR_PAGE_CHUNK_SIZE
            )
            return text, "tesseract_ocr"

        # Tentativa primária: PyMuPDF
        logger.info(f"[{request_id}] Tentando PyMuPDF ({len(pdf_bytes) / 1024:.1f} KB)")
        text = await loop.run_in_executor(_cpu_executor, _pymupdf_extract, pdf_bytes)

        if len(text.strip()) >= 200:
            return text, "pymupdf"

        # Fallback: OCR (PDF escaneado / só imagem)
        logger.info(
            f"[{request_id}] PyMuPDF insuficiente ({len(text.strip())} chars) → OCR chunked"
        )
        text = await loop.run_in_executor(
            _cpu_executor, _ocr_extract_chunked, pdf_bytes, OCR_PAGE_CHUNK_SIZE
        )
        return text, "tesseract_ocr"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "SOL Extractor Worker",
        "cpu_workers": CPU_WORKERS,
        "max_concurrent_extractions": MAX_CONCURRENT_EXTRACTIONS,
    }


@app.post("/extract", dependencies=[Depends(verify_token)], response_model=ExtractResponse)
async def extract_pdf(request: ExtractRequest):
    """
    Extrai texto de um PDF a partir de uma URL pública.

    Fluxo:
      1. Resolve URL real do PDF (se landing page OJS)
      2. Download async (event loop — não bloqueia)
      3. Extração CPU → offload para ProcessPoolExecutor (event loop liberado)
      4. Fallback para abstract scraping se qualquer etapa falhar
    """
    request_id = str(uuid.uuid4())[:8]
    logger.info(
        f"[{request_id}] /extract | url={request.article_url} | force_ocr={request.force_ocr}"
    )

    # 1. Resolve URL real do PDF (ex: landing page OJS → link /download/)
    pdf_url = request.article_url
    if not pdf_url.lower().endswith(".pdf"):
        resolved = await _resolve_pdf_url(pdf_url)
        if resolved:
            pdf_url = resolved
            logger.info(f"[{request_id}] URL resolvida → {pdf_url}")

    # 2. Download
    try:
        pdf_bytes = await _download_pdf(pdf_url)
        logger.info(f"[{request_id}] Download OK | {len(pdf_bytes) / 1024:.1f} KB")
    except Exception as exc:
        logger.warning(f"[{request_id}] Download falhou ({exc}) → fallback abstract")
        abstract = await _scrape_abstract(request.article_url)
        return ExtractResponse(
            success=True,
            method_used="abstract_scraping",
            content_markdown=abstract,
            char_count=len(abstract),
            request_id=request_id,
        )

    # 3. Extração CPU-bound (não bloqueia o event loop)
    try:
        text, method = await _run_extraction(pdf_bytes, request.force_ocr, request_id)
        logger.info(f"[{request_id}] OK | method={method} | chars={len(text)}")
        return ExtractResponse(
            success=True,
            method_used=method,
            content_markdown=text,
            char_count=len(text),
            request_id=request_id,
        )
    except Exception as exc:
        logger.error(f"[{request_id}] Extração falhou ({exc}) → fallback abstract")
        abstract = await _scrape_abstract(request.article_url)
        return ExtractResponse(
            success=True,
            method_used="abstract_scraping",
            content_markdown=abstract,
            char_count=len(abstract),
            request_id=request_id,
        )


@app.post("/extract-upload", dependencies=[Depends(verify_token)], response_model=ExtractResponse)
async def extract_upload(file: UploadFile = File(...)):
    """
    Extrai texto de um PDF enviado via multipart/form-data (upload do usuário).
    Mesmo pipeline de _run_extraction — sem step de download/resolve.
    """
    request_id = str(uuid.uuid4())[:8]

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Apenas arquivos PDF são suportados")

    pdf_bytes = await file.read()
    if len(pdf_bytes) < 100:
        raise HTTPException(status_code=400, detail="Arquivo PDF vazio ou muito pequeno")

    logger.info(
        f"[{request_id}] /extract-upload | file={file.filename} | {len(pdf_bytes) / 1024:.1f} KB"
    )

    try:
        text, method = await _run_extraction(pdf_bytes, force_ocr=False, request_id=request_id)
        logger.info(f"[{request_id}] Upload OK | method={method} | chars={len(text)}")
        return ExtractResponse(
            success=True,
            method_used=method,
            content_markdown=text,
            char_count=len(text),
            request_id=request_id,
        )
    except Exception as exc:
        logger.error(f"[{request_id}] Upload extração falhou: {exc}")
        raise HTTPException(status_code=422, detail="Não foi possível extrair texto do PDF")

import json
import os
import re
import asyncio
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import asyncpg
import httpx
import redis.asyncio as aioredis
from arq.connections import RedisSettings

from notifier import publish_article_update, publish_query_status


DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ["REDIS_URL"]
WORKER_API_KEY = os.environ.get("WORKER_API_KEY", "")
WORKER_BASE_URL = os.environ.get("PYTHON_WORKER_URL", "http://127.0.0.1:8000")
SEMANTIC_SCHOLAR_API_KEY = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")


def _clean_jats(text: str | None) -> str | None:
    if not text:
        return None
    return re.sub(r"<[^>]+>", " ", text).replace("  ", " ").strip()


def _year_from_work(work: dict[str, Any]) -> int | None:
    parts = (
        work.get("published-print", {}).get("date-parts")
        or work.get("published-online", {}).get("date-parts")
        or []
    )
    return parts[0][0] if parts and parts[0] else None


def _authors_from_work(work: dict[str, Any]) -> str | None:
    authors = work.get("author") or []
    names = []
    for author in authors[:8]:
        family = author.get("family")
        given = author.get("given")
        if family and given:
            names.append(f"{family}, {given}")
        elif family:
            names.append(family)
    return "; ".join(names) or None


async def check_and_mark_query_done(ctx, query_id: str) -> None:
    db = ctx["db"]
    redis = ctx["redis"]
    updated = await db.fetchval(
        """
        UPDATE search_queries
        SET status = 'done'
        WHERE id = $1
          AND status NOT IN ('done', 'cancelled', 'needs_refinement')
          AND NOT EXISTS (
            SELECT 1 FROM articles
            WHERE query_id = $1
              AND status NOT IN ('done', 'abstract_only', 'failed')
          )
        RETURNING id
        """,
        query_id,
    )
    if updated:
        await publish_query_status(redis, query_id, "done")


async def _is_cancelled(redis, query_id: str) -> bool:
    return bool(await redis.exists(f"cancel:{query_id}"))


async def _scrape_detail_page(http: httpx.AsyncClient, url: str) -> dict[str, str | None]:
    try:
        resp = await http.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SOLAssistant/1.0)"})
        resp.raise_for_status()
    except Exception:
        return {"doi": None, "keywords": None, "abstract": None}

    html = resp.text
    doi = None
    doi_match = re.search(r'name=["\']citation_doi["\'][^>]*content=["\']([^"\']+)', html, re.I)
    if doi_match:
        doi = doi_match.group(1).replace("https://doi.org/", "").strip()

    abstract = None
    abstract_match = re.search(r'name=["\']DC.Description["\'][^>]*content=["\']([^"\']+)', html, re.I)
    if abstract_match:
        abstract = abstract_match.group(1).strip()

    keywords = None
    keywords_match = re.search(r'<div[^>]*class=["\'][^"\']*keywords[^"\']*["\'][\s\S]*?<div[^>]*class=["\']value["\'][^>]*>([\s\S]*?)</div>', html, re.I)
    if keywords_match:
        keywords = re.sub(r"<[^>]+>", " ", keywords_match.group(1)).replace("  ", " ").strip()

    return {"doi": doi, "keywords": keywords, "abstract": abstract}


async def _crossref_enrich(http: httpx.AsyncClient, doi: str) -> dict[str, Any]:
    try:
        resp = await http.get(
            f"https://api.crossref.org/works/{doi}",
            headers={"User-Agent": "SOLAssistant/1.0 (mailto:dev@example.com)"},
        )
        resp.raise_for_status()
        work = resp.json().get("message") or {}
    except Exception:
        return {}

    keywords = [*(work.get("keyword") or []), *(work.get("subject") or [])]
    return {
        "abstract": _clean_jats(work.get("abstract")),
        "keywords": ", ".join(keywords) if keywords else None,
        "citation_count": work.get("is-referenced-by-count"),
        "publisher": work.get("publisher"),
        "is_open_access": bool(work.get("license")),
        "publication_year": _year_from_work(work),
        "authors": _authors_from_work(work),
        "source_name": (work.get("container-title") or [None])[0],
    }


async def _semantic_scholar(http: httpx.AsyncClient, doi: str) -> dict[str, Any]:
    if not SEMANTIC_SCHOLAR_API_KEY:
        return {}
    safe_doi = "/".join(quote(part, safe="") for part in doi.split("/"))
    fields = "references.title,references.externalIds,citations.title,citations.externalIds,tldr,authors.name,authors.hIndex,authors.citationCount,abstract,openAccessPdf,publicationDate,year,fieldsOfStudy,citationCount,influentialCitationCount"
    try:
        resp = await http.get(
            f"https://api.semanticscholar.org/graph/v1/paper/DOI:{safe_doi}?fields={fields}",
            headers={"User-Agent": "SOLAssistant/1.0", "x-api-key": SEMANTIC_SCHOLAR_API_KEY},
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return {}

    def paper_ref(paper: dict[str, Any]) -> dict[str, Any]:
        ext = paper.get("externalIds") or {}
        return {"title": paper.get("title"), "doi": ext.get("DOI")}

    return {
        "citation_graph": {
            "references": [paper_ref(p) for p in data.get("references", [])[:50]],
            "citations": [paper_ref(p) for p in data.get("citations", [])[:50]],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "open_access_pdf": data.get("openAccessPdf"),
            "fields_of_study": data.get("fieldsOfStudy"),
            "influential_citation_count": data.get("influentialCitationCount"),
        },
        "tldr_content": (data.get("tldr") or {}).get("text"),
        "abstract": data.get("abstract"),
        "citation_count": data.get("citationCount"),
        "publication_year": data.get("year"),
        "is_open_access": bool((data.get("openAccessPdf") or {}).get("url")),
        "authors": "; ".join(
            f"{a.get('name')} (h-index: {a.get('hIndex')}, citations: {a.get('citationCount')})"
            for a in (data.get("authors") or [])[:8]
            if a.get("name")
        ) or None,
    }


async def _extract_pdf(http: httpx.AsyncClient, url: str) -> dict[str, Any]:
    resp = await http.post(
        f"{WORKER_BASE_URL}/extract",
        headers={"Content-Type": "application/json", "X-Worker-Token": WORKER_API_KEY},
        json={"article_url": url, "force_ocr": False},
        timeout=180,
    )
    resp.raise_for_status()
    return resp.json()


import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def decrypt_secret(payload: str, raw_key: str) -> str:
    key = hashlib.sha256(raw_key.encode('utf-8')).digest()
    parts = payload.split('.')
    if len(parts) != 3:
        raise ValueError("Invalid encrypted payload format")
    iv = base64.b64decode(parts[0])
    tag = base64.b64decode(parts[1])
    ciphertext = base64.b64decode(parts[2])
    aesgcm = AESGCM(key)
    decrypted = aesgcm.decrypt(iv, ciphertext + tag, None)
    return decrypted.decode('utf-8')


async def resolve_user_llm_config(db, user_id: str | None) -> tuple[str, str, str]:
    fallback_provider = (os.environ.get("LLM_PROVIDER") or "google").lower()
    default_models = {
        "google": "gemini-2.5-flash-lite",
        "openai": "gpt-4o-mini",
        "groq": "llama-3.1-8b-instant",
    }
    fallback_model = os.environ.get("LLM_MODEL_TLDR") or os.environ.get("LLM_MODEL") or default_models.get(fallback_provider, "gemini-2.5-flash-lite")
    fallback_env_keys = {
        "google": "GOOGLE_GENERATIVE_AI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "groq": "GROQ_API_KEY",
    }
    fallback_key = os.environ.get(fallback_env_keys.get(fallback_provider, "GOOGLE_GENERATIVE_AI_API_KEY"), "")

    if not user_id or user_id == "anonymous":
        return fallback_provider, fallback_key, fallback_model

    row = await db.fetchrow(
        "SELECT provider, encrypted_api_key, use_own_key, models FROM user_llm_settings WHERE user_id = $1",
        user_id,
    )
    if not row:
        return fallback_provider, fallback_key, fallback_model

    provider = (row["provider"] or fallback_provider).lower()
    use_own_key = bool(row["use_own_key"])
    encrypted_key = row["encrypted_api_key"]
    raw_models = row["models"]
    models = json.loads(raw_models) if isinstance(raw_models, str) else (raw_models or {})

    model = models.get("tldr") or default_models.get(provider, fallback_model)

    api_key = None
    if use_own_key and encrypted_key:
        secret = os.environ.get("USER_SECRET_ENCRYPTION_KEY") or os.environ.get("AUTH_SECRET")
        if secret:
            try:
                api_key = decrypt_secret(encrypted_key, secret)
            except Exception as e:
                print(f"[queue_worker] Erro ao decifrar chave do usuário {user_id}: {e}")

    if not api_key:
        env_var_name = fallback_env_keys.get(provider, "GOOGLE_GENERATIVE_AI_API_KEY")
        api_key = os.environ.get(env_var_name, "")

    return provider, api_key, model


async def _llm_generate_tldr(
    http: httpx.AsyncClient,
    provider: str,
    api_key: str,
    model: str,
    prompt: str,
    system: str,
    timeout: int = 45,
) -> str | None:
    if not api_key:
        print(f"[queue_worker] API Key ausente para provider {provider}")
        return None

    for attempt in range(1, 5):
        try:
            if provider == "google":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                resp = await http.post(
                    url,
                    json={
                        "systemInstruction": {"parts": [{"text": system}]},
                        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.2},
                    },
                    timeout=timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                return (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [{}])[0].get("text")

            elif provider in {"openai", "groq"}:
                endpoint = (
                    "https://api.openai.com/v1/chat/completions"
                    if provider == "openai"
                    else "https://api.groq.com/openai/v1/chat/completions"
                )
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 1000,
                    "temperature": 0.2,
                }
                resp = await http.post(endpoint, headers=headers, json=payload, timeout=timeout)
                resp.raise_for_status()
                data = resp.json()
                choices = data.get("choices") or []
                if choices and len(choices) > 0:
                    return choices[0].get("message", {}).get("content")
                return None
            else:
                print(f"[queue_worker] Provider não suportado: {provider}")
                return None
        except httpx.HTTPStatusError as e:
            err_detail = e.response.text if hasattr(e, 'response') and e.response else str(e)
            if e.response.status_code == 429 and attempt < 4:
                wait_time = 2 ** attempt
                print(f"[queue_worker] Rate limit (429) no {provider} ({model}). Tentativa {attempt}/4. Aguardando {wait_time}s...")
                await asyncio.sleep(wait_time)
                continue
            print(f"[queue_worker] HTTP {e.response.status_code} no {provider} ({model}): {err_detail[:300]}")
            raise
        except Exception as e:
            if attempt < 4:
                wait_time = 2 ** attempt
                print(f"[queue_worker] Erro ao chamar {provider} ({model}): {repr(e)}. Tentativa {attempt}/4. Aguardando {wait_time}s...")
                await asyncio.sleep(wait_time)
                continue
            raise
    return None


async def _embed_text(http: httpx.AsyncClient, text: str, user_api_key: str | None = None, provider: str | None = None) -> list[float] | None:
    if not text:
        return None

    emb_provider = (provider or os.environ.get("EMBEDDING_PROVIDER") or os.environ.get("LLM_PROVIDER") or "google").lower()
    if emb_provider == "groq":
        emb_provider = "google"

    for attempt in range(1, 4):
        try:
            if emb_provider == "openai":
                api_key = user_api_key or os.environ.get("OPENAI_API_KEY")
                if not api_key:
                    return None
                model = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
                resp = await http.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"input": text[:2000], "model": model, "dimensions": 768},
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
                return (data.get("data") or [{}])[0].get("embedding")
            else:
                api_key = os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
                if not api_key:
                    return None
                model = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={api_key}"
                resp = await http.post(
                    url,
                    json={
                        "model": f"models/{model}",
                        "content": {"parts": [{"text": text[:2000]}]},
                        "outputDimensionality": 768,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                return (resp.json().get("embedding") or {}).get("values")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < 3:
                await asyncio.sleep(2 ** attempt)
                continue
            return None
        except Exception:
            return None
    return None


async def process_single_article(ctx, *, article_id: str, query_id: str, user_id: str, tldr_lang: str = "pt"):
    redis = ctx["redis"]
    db = ctx["db"]
    http = ctx["http"]

    try:
        if await _is_cancelled(redis, query_id):
            await db.execute("UPDATE articles SET status='failed' WHERE id=$1", article_id)
            await publish_article_update(redis, query_id, article_id=article_id, status="failed")
            return {"cancelled": True}

        article = await db.fetchrow("SELECT * FROM articles WHERE id=$1", article_id)
        if not article:
            return {"error": "article not found"}
        if article["status"] in {"done", "abstract_only", "failed"}:
            await check_and_mark_query_done(ctx, query_id)
            return {"skipped": True, "status": article["status"]}

        is_user_upload = article["metadata_source"] in {"user_upload", "user_doi"}
        markdown = article["markdown_content"] or ""
        doi = article["doi"]

        if not is_user_upload:
            scraped = await _scrape_detail_page(http, article["original_url"])
            doi = doi or scraped.get("doi")
            await db.execute(
                """
                UPDATE articles
                SET doi=COALESCE($2, doi), keywords=COALESCE($3, keywords), abstract=COALESCE($4, abstract)
                WHERE id=$1
                """,
                article_id,
                doi,
                scraped.get("keywords"),
                scraped.get("abstract"),
            )

        if doi:
            crossref = await _crossref_enrich(http, doi)
            if crossref:
                await db.execute(
                    """
                    UPDATE articles
                    SET abstract=COALESCE($2, abstract), keywords=COALESCE($3, keywords),
                        citation_count=COALESCE($4, citation_count), publisher=COALESCE($5, publisher),
                        is_open_access=COALESCE($6, is_open_access), publication_year=COALESCE($7, publication_year),
                        authors=COALESCE($8, authors), source_name=COALESCE($9, source_name), metadata_source='crossref'
                    WHERE id=$1
                    """,
                    article_id,
                    crossref.get("abstract"),
                    crossref.get("keywords"),
                    crossref.get("citation_count"),
                    crossref.get("publisher"),
                    crossref.get("is_open_access"),
                    crossref.get("publication_year"),
                    crossref.get("authors"),
                    crossref.get("source_name"),
                )

            s2 = await _semantic_scholar(http, doi)
            if s2:
                await db.execute(
                    """
                    UPDATE articles
                    SET citation_graph=$2::jsonb, tldr_content=COALESCE($3, tldr_content),
                        authors=COALESCE($4, authors), abstract=COALESCE($5, abstract),
                        citation_count=COALESCE($6, citation_count), publication_year=COALESCE($7, publication_year),
                        is_open_access=COALESCE($8, is_open_access)
                    WHERE id=$1
                    """,
                    article_id,
                    json.dumps(s2.get("citation_graph")),
                    s2.get("tldr_content"),
                    s2.get("authors"),
                    s2.get("abstract"),
                    s2.get("citation_count"),
                    s2.get("publication_year"),
                    s2.get("is_open_access"),
                )

        if not is_user_upload:
            await db.execute("UPDATE articles SET status='extracting' WHERE id=$1", article_id)
            await publish_article_update(redis, query_id, article_id=article_id, status="extracting")
            extraction = await _extract_pdf(http, article["original_url"])
            if not extraction.get("success"):
                await db.execute("UPDATE articles SET status='failed' WHERE id=$1", article_id)
                await publish_article_update(redis, query_id, article_id=article_id, status="failed")
                await check_and_mark_query_done(ctx, query_id)
                return {"failed": True, "reason": "extract_failed"}
            markdown = (extraction.get("content_markdown") or "").replace("\x00", "")
            worker_status = "abstract_only" if extraction.get("method_used") == "abstract_scraping" else "llm_processing"
            await db.execute(
                "UPDATE articles SET markdown_content=$2, status=$3 WHERE id=$1",
                article_id,
                markdown,
                worker_status,
            )
            await publish_article_update(redis, query_id, article_id=article_id, status=worker_status)

        provider, api_key, model = await resolve_user_llm_config(db, user_id)

        enriched = await db.fetchrow("SELECT abstract, keywords, tldr_content FROM articles WHERE id=$1", article_id)
        existing_tldr = enriched["tldr_content"] if enriched else None
        if existing_tldr and len(existing_tldr) > 10:
            tldr = existing_tldr
        else:
            lang = "English" if tldr_lang == "en-US" else "Español" if tldr_lang == "es" else "Português do Brasil"
            context = f"Resumo do autor: {enriched['abstract']}\nPalavras-chave: {enriched['keywords']}" if enriched else ""
            tldr = await _llm_generate_tldr(
                http,
                provider,
                api_key,
                model,
                f"{context}\n\nGere a síntese:\n\n{markdown[:30000]}",
                f"Você é um assistente acadêmico. Crie uma síntese estruturada neste formato: 🔍 Problema: ...\n🛠 Método: ...\n✅ Resultado: ... Máximo 600 caracteres. Obrigatoriamente em {lang}.",
            )

        embed_source = tldr or (enriched["abstract"] if enriched else None)
        embedding = await _embed_text(http, embed_source or "", user_api_key=api_key, provider=provider)
        if embedding:
            await db.execute(
                "UPDATE articles SET abstract_embedding=$2::vector WHERE id=$1",
                article_id,
                json.dumps(embedding),
            )

        status = "done" if tldr else "failed"
        final_tldr = tldr or "Falha ao gerar síntese via IA."
        await db.execute(
            "UPDATE articles SET tldr_content=$2, status=$3 WHERE id=$1",
            article_id,
            final_tldr,
            status,
        )
        await publish_article_update(
            redis,
            query_id,
            article_id=article_id,
            status=status,
            tldr_content=final_tldr,
        )
        await check_and_mark_query_done(ctx, query_id)
        return {"status": status, "article_id": article_id}
    except Exception:
        await db.execute("UPDATE articles SET status='failed' WHERE id=$1", article_id)
        await publish_article_update(redis, query_id, article_id=article_id, status="failed")
        await check_and_mark_query_done(ctx, query_id)
        raise


async def startup(ctx):
    for attempt in range(1, 15):
        try:
            ctx["db"] = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
            ctx["redis"] = await aioredis.from_url(REDIS_URL, decode_responses=True)
            ctx["http"] = httpx.AsyncClient(timeout=30, follow_redirects=True)
            print("[queue_worker] Conectado ao DB e Redis com sucesso.")
            return
        except Exception as e:
            print(f"[queue_worker] Tentativa de conexão {attempt}/15 falhou: {e}. Tentando novamente em 3s...")
            await asyncio.sleep(3)
    raise RuntimeError("Não foi possível conectar ao DB/Redis após 15 tentativas")


async def shutdown(ctx):
    if "db" in ctx:
        await ctx["db"].close()
    if "redis" in ctx:
        await ctx["redis"].aclose()
    if "http" in ctx:
        await ctx["http"].aclose()


async def process_pending_loop() -> None:
    ctx: dict[str, Any] = {}
    await startup(ctx)
    redis = ctx["redis"]
    try:
        while True:
            try:
                item = await redis.brpop("core:article.process.pending", timeout=5)
                if not item:
                    continue
                _queue, raw = item
                data = json.loads(raw)
                await process_single_article(
                    ctx,
                    article_id=data["article_id"],
                    query_id=data["query_id"],
                    user_id=data.get("user_id", "anonymous"),
                    tldr_lang=data.get("tldr_lang", "pt"),
                )
            except Exception as e:
                print(f"[queue_worker] Erro no loop de processamento: {e}")
                await asyncio.sleep(2)
    finally:
        await shutdown(ctx)


class WorkerSettings:
    functions = [process_single_article]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    max_jobs = int(os.environ.get("MAX_CONCURRENT_EXTRACTIONS", "4") or "4")
    job_timeout = int(os.environ.get("ARTICLE_JOB_TIMEOUT", "300"))
    max_tries = 3
    on_startup = startup
    on_shutdown = shutdown


if __name__ == "__main__":
    asyncio.run(process_pending_loop())

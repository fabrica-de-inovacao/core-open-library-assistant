# Deploy no Coolify v4

## Visão geral

Stack v2 sem Supabase/Inngest. O Coolify hospeda:

| Resource | Tipo | Exposição |
|---|---|---|
| `postgres` | PostgreSQL separado | interno |
| `redis` | Redis separado | interno |
| `app` | Docker Compose service | público `https://core.seudominio.com` |
| `python-worker` | Docker Compose service | público `https://worker.seudominio.com` |

O app chama o worker pela rede interna: `http://python-worker:8000`. O domínio público do worker existe para uso externo futuro.

## Decisões

- Postgres separado no Coolify: backups, restore e storage mais simples.
- Redis separado no Coolify: fila BullMQ e streams sem acoplar estado ao deploy da app.
- `python-worker` exposto: permitido, mas endpoints sensíveis exigem `X-Worker-Token: WORKER_API_KEY`.
- Migrations rodam manualmente após deploy. Não rodar migrations em boot.
- `USER_SECRET_ENCRYPTION_KEY` deve ser estável. Se mudar, chaves LLM salvas pelos usuários não decifram.

## 1. Criar Postgres

No Coolify: **New Resource -> PostgreSQL**.

Requisito: `pgvector`. Se o Postgres padrão não tiver a extensão, crie um Postgres custom com imagem:

```text
pgvector/pgvector:pg16
```

Depois confirme no terminal SQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Guarde a URL interna como `DATABASE_URL`.

## 2. Criar Redis

No Coolify: **New Resource -> Redis**.

Guarde a URL interna como `REDIS_URL`.

## 3. Criar Docker Compose Resource

1. **New Resource -> Docker Compose**.
2. Selecione o repositório e branch.
3. Configure **Docker Compose Location**:

```text
docker-compose.coolify.yml
```

4. Configure domínio do serviço `app` com target port `3000`.
5. Configure domínio do serviço `python-worker` com target port `8000`.

O compose usa `expose`, não `ports`, para não fazer bind de `0.0.0.0:3000` ou `0.0.0.0:8000` no host. O Traefik do Coolify roteia para as portas internas.

## 4. Environment Variables

Configure no resource Docker Compose:

```env
NEXT_PUBLIC_APP_URL=https://core.seudominio.com
AUTH_URL=https://core.seudominio.com

DATABASE_URL=<internal postgres url do Coolify>
REDIS_URL=<internal redis url do Coolify>

AUTH_SECRET=<openssl rand -base64 32>
USER_SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
WORKER_API_KEY=<openssl rand -hex 32>

AUTH_GOOGLE_ID=<google-client-id>.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=<google-client-secret>

OPENAI_API_KEY=<fallback opcional>
GOOGLE_GENERATIVE_AI_API_KEY=<fallback opcional>
GROQ_API_KEY=<fallback opcional>

LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_MODEL_SYNTHESIS=gpt-4o-mini
LLM_MODEL_STRATEGY=gpt-4o-mini
LLM_MODEL_RERANKER=gpt-4o-mini
LLM_MODEL_TLDR=gpt-4o-mini

EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small

SEMANTIC_SCHOLAR_API_KEY=
EXTRACTION_UVICORN_WORKERS=2
OCR_PAGE_CHUNK_SIZE=10
```

Marque também `NEXT_PUBLIC_APP_URL` como **Build Arg**.

## 5. Google OAuth

No Google Cloud Console, adicione o redirect URI:

```text
https://core.seudominio.com/api/auth/callback/google
```

## 6. Primeiro Deploy

1. Deploy do Docker Compose resource.
2. Aguarde `app` e `python-worker` ficarem healthy.
3. Rode migrations no terminal do container `app`:

```bash
yarn db:migrate
```

4. Acesse:

```text
https://core.seudominio.com
```

5. Teste health do worker:

```text
https://worker.seudominio.com/health
```

## 7. Teste Worker Externo

Exemplo de chamada protegida:

```bash
curl -X POST https://worker.seudominio.com/extract \
  -H "Content-Type: application/json" \
  -H "X-Worker-Token: $WORKER_API_KEY" \
  -d '{"article_url":"https://example.com/paper.pdf","force_ocr":false}'
```

## Troubleshooting

### Migrations falham com `type "vector" does not exist`

Postgres não tem pgvector. Use `pgvector/pgvector:pg16` ou instale extensão compatível.

### Artigos ficam `pending`

Verifique:

- `REDIS_URL` igual em `app` e `python-worker`.
- `ENABLE_ARQ_WORKER='1'` no worker.
- Logs do `python-worker`.

### Worker público retorna 401/403

Confirme header:

```text
X-Worker-Token: <WORKER_API_KEY>
```

### Chave OpenAI do usuário não decifra

`USER_SECRET_ENCRYPTION_KEY` mudou ou não está igual entre `app` e `python-worker`.

### OAuth redirect loop

`AUTH_URL` deve ser a URL pública exata, sem trailing slash.

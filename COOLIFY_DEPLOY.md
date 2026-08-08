# Deploy no Coolify v4

## Visão geral

O projeto tem 3 serviços deployados como **Docker Compose Stack** no Coolify:

| Serviço | Imagem | Porta interna |
|---------|--------|---------------|
| `app` | Build do Dockerfile raiz (Next.js) | 3000 |
| `python-worker` | Build do `worker/Dockerfile` (FastAPI) | 8000 |
| `inngest` | `inngest/inngest:latest` | 8288 |

Apenas `app` é exposto publicamente via Traefik. Os outros dois ficam na rede interna do stack.

---

## Pré-requisitos

- Repositório no GitHub (ou GitLab/Gitea)
- Supabase project configurado com as migrations aplicadas (`yarn db:migrate`)
- Google Cloud OAuth credentials (console.cloud.google.com)
- Google AI API key (aistudio.google.com)
- Domínio apontando para o IP da VPS

---

## Passo a Passo

### 1. Criar o recurso no Coolify

1. No Coolify: **New Resource → Docker Compose**
2. Selecione o repositório e branch (`main`)
3. Em **Docker Compose Location**: `docker-compose.coolify.yml`
4. Em **Domain**: configure seu domínio (ex: `core.seudominio.com`)
5. Coolify adicionará automaticamente os labels Traefik no serviço `app`

> O Coolify detecta qual serviço expor pelo campo `ports`. Confirme que apenas `app:3000` é roteado pelo proxy.

---

### 2. Configurar Build Arguments

Em **Configuration → Environment Variables**, adicione as variáveis com o toggle **"Build Arg"** ativado:

```
NEXT_PUBLIC_SUPABASE_URL          = https://PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     = eyJ...
NEXT_PUBLIC_APP_URL               = https://core.seudominio.com
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = sb_publishable_...
```

> **Crítico**: essas variáveis são embutidas no bundle JS em build time. Devem ser configuradas ANTES do primeiro deploy.

---

### 3. Configurar Variáveis de Ambiente (Runtime)

Adicione todas as variáveis abaixo na aba **Environment** (sem toggle Build Arg):

```bash
# App
AUTH_URL=https://core.seudominio.com
NODE_ENV=production

# Auth
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=<id>.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=<secret>

# Banco
DATABASE_URL=postgresql://postgres.PROJETO:SENHA@aws-X.pooler.supabase.com:6543/postgres

# Inngest (self-hosted no stack — URL interna)
INNGEST_BASE_URL=http://inngest:8288
INNGEST_API_KEY=sk_inngest_<string longa>
INNGEST_SIGNING_KEY=signkey-prod-<openssl rand -hex 32>
INNGEST_EVENT_KEY=<string longa>
INNGEST_BASIC_AUTH=          # deixar vazio se não configurou auth no Inngest

# Worker (URL interna do stack)
PYTHON_WORKER_URL=http://python-worker:8000
WORKER_API_KEY=sk_worker_<openssl rand -hex 32>

# AI
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
LLM_PROVIDER=google
EMBEDDING_MODEL=gemini-embedding-001

# Logging
LOG_MODE=production
```

---

### 4. Google OAuth — Authorized Redirect URIs

No Google Cloud Console, adicione:

```
https://core.seudominio.com/api/auth/callback/google
```

---

### 5. Primeiro Deploy

1. Clique em **Deploy** no Coolify
2. Acompanhe os logs do build — o Next.js build demora ~3-5min
3. Após deploy, acesse `https://core.seudominio.com`

---

### 6. Aplicar Migrations do Banco

Após o primeiro deploy, rode as migrations via Coolify Terminal ou localmente:

```bash
# Localmente com DATABASE_URL configurado:
yarn db:migrate

# Ou via Coolify → Terminal do container app:
yarn db:migrate
```

---

## Atualização do Inngest Após Deploy

O Inngest self-hosted precisa ser notificado da URL do handler após cada deploy:

O Next.js registra automaticamente via `INNGEST_BASE_URL` + a rota `/api/inngest`.
Não é necessária ação manual se `INNGEST_BASE_URL=http://inngest:8288`.

---

## Variáveis que NÃO precisam ser configuradas

Têm fallback no código e são opcionais:

| Variável | Default |
|----------|---------|
| `LLM_MODEL`, `LLM_MODEL_*` | Modelos definidos em `ai-provider.ts` |
| `SEMANTIC_SCHOLAR_API_KEY` | Rate limit menor, mas funciona sem |
| `EXTRACTION_UVICORN_WORKERS` | 2 |
| `EXTRACTION_WORKERS` | `cpu_count` |
| `MAX_CONCURRENT_EXTRACTIONS` | `EXTRACTION_WORKERS * 2` |
| `OCR_PAGE_CHUNK_SIZE` | 10 |

---

## Troubleshooting

### Build falha com "missing env var"
`SKIP_ENV_VALIDATION=1` já está no Dockerfile. Se ainda falhar, verifique os Build Args.

### OAuth redirect loop
`AUTH_URL` deve ser exatamente a URL pública sem trailing slash.

### Artigos ficam em `pending` para sempre
O worker Python não está acessível. Verifique:
- `PYTHON_WORKER_URL=http://python-worker:8000` (nome do serviço no compose)
- `WORKER_API_KEY` é o mesmo nos dois serviços
- Logs do container `python-worker` no Coolify

### Inngest jobs não disparam
- Verifique `INNGEST_BASE_URL` aponta para `http://inngest:8288`
- O Inngest precisa que a app esteja up para registrar os handlers — reinicie o `app` após o `inngest` subir

### Erros de DB "prepare: false"
Já configurado no `db/index.ts`. Se aparecer erro de prepared statement, o `DATABASE_URL` deve usar a porta `6543` (transaction pooler), não `5432`.

# SOL Open Library Assistant

A SOL Open Library Assistant é uma plataforma open-source com interface de ponta ("SciSpace style") projetada para pesquisadores. Ela utiliza Inteligência Artificial e LLMs para automatizar Revisões Sistemáticas da Literatura, buscando artigos na base da SBC, extraindo metadados e gerando análises estruturadas.

## Tecnologias Principais
- **Frontend/Backend:** Next.js 14 (App Router), React, TailwindCSS, Shadcn UI
- **Banco de Dados:** Supabase (PostgreSQL) com Drizzle ORM
- **IA e LLMs:** Vercel AI SDK, Modelos base (Google/OpenAI)
- **Background Jobs:** Inngest
- **Scraping Worker:** Python (Dockerizado)

---

## 🚀 Como Rodar o Projeto (Ambiente de Desenvolvimento)

Para que a arquitetura inteira funcione em tempo real (Chat -> Busca -> Fila de Processamento -> Extração Python -> Atualização UI), você precisará rodar **3 processos simultâneos** em terminais separados.

### Pré-requisitos
Antes de começar, certifique-se de ter instalado:
- Node.js (v18+) e Yarn/NPM
- Docker e Docker Compose (para rodar o Worker Python)
- (Opcional) CLI do Inngest instalada globalmente ou via `npx`

---

### Passo 1: Subir o Worker de Extração (Python / Docker)
O Worker de Python é responsável por fazer o bypass e o scraping dos metadados através de Puppeteer e bibliotecas Python. Ele roda isolado no Docker.

No **Terminal 1**, execute:
```bash
yarn docker:up
# ou "npm run docker:up"
```
*(Se você quiser ver os logs do worker trabalhando: `yarn worker:logs`)*

---

### Passo 2: Subir o Orquestrador de Filas (Inngest)
O Inngest é o coração assíncrono do projeto. Ele gerencia o fluxo entre a requisição do usuário, os passos de scraping no Python e a persistência final no Supabase, garantindo que a extração não sofra timeout (falha de tempo limite).

No **Terminal 2**, execute:
```bash
yarn inngest:dev
# ou "npm run inngest:dev"
# Isso iniciará o servidor Inngest em http://127.0.0.1:8288
```

---

### Passo 3: Subir a Aplicação Principal (Next.js)
Por fim, inicie o app front-end e os endpoints de API do Next.js.

No **Terminal 3**, execute:
```bash
yarn dev
# ou "npm run dev"
```

A aplicação estará disponível em: [http://localhost:3000](http://localhost:3000)

---

## 📜 Resumo dos Scripts de Desenvolvimento criados no `package.json`

| Comando | Descrição |
| :--- | :--- |
| `yarn dev` | Inicia a aplicação principal Next.js |
| `yarn inngest:dev` | Inicia o servidor local do Inngest (gerenciador de filas) |
| `yarn docker:up` | Sobe todos os containers definidos via Docker Compose (Worker) |
| `yarn docker:down` | Desliga e limpa os containers ativos do projeto |
| `yarn worker:up` | Força a subida exclusiva do serviço `python-worker` |
| `yarn worker:logs` | "Tail" (Acompanha ao vivo) os logs do container do Python Worker |
| `yarn build` | Cria o build de produção do Next.js |

---

## Estrutura de Pastas e Roteamento

- `src/app/(auth)/login`: Interface Premium de Autenticação.
- `src/app/workspace`: Raiz do workspace da aplicação, com a caixa de busca "Hero".
- `src/app/workspace/query/[id]`: Rota da página de Live Extraction de uma busca ativa, com chat assíncrono via painel dividido.
- `src/app/api/inngest`: Handlers das funções background do ciclo de IA.
- `worker/`: Fonte do servidor FastAPI Python para execução isolada de tarefas complexas.

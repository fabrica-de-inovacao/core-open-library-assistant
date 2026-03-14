import { serve } from 'inngest/next';
import { inngest } from '@/server/inngest/client';
import { processArticlesBatch, processSingleArticle } from '@/server/inngest/functions';
// F-03: valida env vars obrigatórias na inicialização do worker
import '@/lib/env-check';

// Se estiver conectando a um servidor Inngest Self-Hosted (Droplet), 
// ele opera como um "Dev Server" estendido e não assina as requisições (webhooks).
// Para evitar o erro "No x-inngest-signature provided" na Vercel, removemos a signing key 
// da memória temporariamente caso INNGEST_BASE_URL esteja definido.
// Se estiver conectando a um servidor Inngest Self-Hosted (Droplet), 
// ele opera como um "Dev Server" estendido e não assina as requisições (webhooks).
// Para evitar o erro "No signing key found" ou "No x-inngest-signature" na Vercel,
// forçamos o SDK a entrar em modo "Dev" programaticamente.
if (process.env.INNGEST_BASE_URL) {
  process.env.INNGEST_DEV = 'true';
}

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processArticlesBatch, processSingleArticle],
  serveHost: process.env.AUTH_URL || undefined,
});

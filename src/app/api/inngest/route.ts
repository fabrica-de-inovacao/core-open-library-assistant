import { serve } from 'inngest/next';
import { inngest } from '@/server/inngest/client';
import { processArticlesBatch, processSingleArticle } from '@/server/inngest/functions';
// F-03: valida env vars obrigatórias na inicialização do worker
import '@/lib/env-check';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processArticlesBatch, processSingleArticle],
});

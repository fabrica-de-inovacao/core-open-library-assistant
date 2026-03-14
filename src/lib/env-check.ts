/**
 * F-03: Verificação de variáveis de ambiente obrigatórias na inicialização.
 * Lança um erro claro em vez de falhas silenciosas em produção.
 *
 * Importar no topo de `src/app/api/inngest/route.ts` ou no layout raiz
 * para que seja validado antes de qualquer handler ser invocado.
 */

const REQUIRED_ENV_VARS: string[] = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'GOOGLE_GENERATIVE_AI_API_KEY', // nome exato usado pelo @ai-sdk/google
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

// Variáveis obrigatórias apenas em produção (Inngest Cloud)
const PROD_ONLY_ENV_VARS: string[] = ['INNGEST_SIGNING_KEY', 'INNGEST_EVENT_KEY'];

/** Executa a validação. Chame uma vez no startup (ex: src/app/layout.tsx ou route handler). */
export function checkRequiredEnvVars(): void {
  // Skip validation during builds
  if (
    process.env.SKIP_ENV_VALIDATION === '1' ||
    process.env.SKIP_ENV_VALIDATION === 'true' ||
    process.env.npm_lifecycle_event === 'build'
  ) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const msg = `[env-check] ❌ Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`;
    if (isProduction) {
      throw new Error(msg);
    } else {
      console.warn(msg);
    }
  }

  // Em produção, verificar também as vars do Inngest Cloud,
  // MAS ignorar caso estejamos usando o servidor self-hosted (Droplet)
  const isSelfHosted = !!process.env.INNGEST_BASE_URL;
  if (isProduction && !isSelfHosted) {
    const missingProd = PROD_ONLY_ENV_VARS.filter((key) => !process.env[key]);
    if (missingProd.length > 0) {
      throw new Error(
        `[env-check] ❌ Variáveis obrigatórias em produção ausentes: ${missingProd.join(', ')}`
      );
    }
  }
}

// Executa automaticamente ao importar (módulo side-effect)
checkRequiredEnvVars();

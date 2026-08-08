/**
 * F-03: Verificação de variáveis de ambiente obrigatórias na inicialização.
 * Lança um erro claro em vez de falhas silenciosas em produção.
 *
 * Importar no topo de um route handler ou no layout raiz
 * para que seja validado antes de qualquer handler ser invocado.
 */

const REQUIRED_ENV_VARS: string[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'AUTH_SECRET',
];

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

}

// Executa automaticamente ao importar (módulo side-effect)
checkRequiredEnvVars();

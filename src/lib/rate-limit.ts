/**
 * F-04: Rate limiting simples em memória para rotas de API públicas.
 *
 * Estratégia: sliding-window por IP (ou userId quando autenticado).
 * Sem dependências externas — funciona em edge runtime e Node.js.
 *
 * Limitações:
 * - Não persiste entre reinicializações do processo (aceitável em dev/prod leve).
 * - Em múltiplas instâncias Vercel (serverless), cada instância tem seu próprio
 *   contador — use Upstash Redis para produção com alto volume.
 *
 * Uso:
 *   const limit = rateLimit({ limit: 10, windowMs: 60_000 });
 *   const result = limit.check(ip);
 *   if (!result.allowed) return NextResponse.json({ error: 'Rate limit' }, { status: 429 });
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Número máximo de requisições permitidas na janela. */
  limit: number;
  /** Tamanho da janela em milissegundos. Padrão: 60.000 (1 minuto). */
  windowMs?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit({ limit, windowMs = 60_000 }: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();

  // Limpeza periódica para evitar vazamento de memória
  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  };
  // Limpa a cada 5 minutos
  if (typeof setInterval !== 'undefined') {
    setInterval(cleanup, 5 * 60_000);
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || entry.resetAt < now) {
        // Janela expirada ou nova chave: resetar contador
        const resetAt = now + windowMs;
        store.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: limit - 1, resetAt };
      }

      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
      }

      entry.count += 1;
      return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
    },
  };
}

/**
 * Extrai o IP do cliente a partir dos headers da request.
 * Funciona em Vercel, Cloudflare e servidores padrão.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous'
  );
}

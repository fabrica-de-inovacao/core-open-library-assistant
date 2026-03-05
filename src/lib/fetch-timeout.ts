/**
 * Wrapper sobre fetch() com timeout automático via AbortController.
 *
 * Motivo: o padrão `AbortController + setTimeout + .finally(clearTimeout)`
 * estava repetido em 4 lugares diferentes no pipeline Inngest (scrape,
 * CrossRef, infer-metadata CrossRef, HEAD do PDF). Centralizar aqui
 * elimina a duplicação, garante que o timer sempre é limpo e padroniza
 * o tratamento de AbortError para os callers.
 *
 * @param url       - URL a ser buscada
 * @param options   - RequestInit padrão do fetch (headers, method, body…)
 * @param timeoutMs - Timeout em milissegundos (padrão: 15 s)
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    // Garante limpeza do timer mesmo em caso de erro ou abort
    clearTimeout(timer);
  }
}

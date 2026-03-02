/**
 * D-03: Mapper centralizado de artigos.
 *
 * Responsabilidade: normalizar os campos nullable do DB com defaults consistentes,
 * eliminando a duplicação de `?? 'Autor desconhecido'` e `?? 'N/A'` espalhada pelo codebase.
 *
 * Uso:
 *   import { normalizeArticle, formatArticleReference } from '@/lib/mappers/article';
 */

import type { articles } from '@/server/db/schema';

/** Artigo bruto conforme retornado pelo Drizzle ORM. */
export type RawArticle = typeof articles.$inferSelect;

/** Artigo normalizado: todos os campos têm defaults aplicados. */
export interface NormalizedArticle extends RawArticle {
  /** Autores como string formatada. Nunca null pós-normalização. */
  authors: string;
  /** DOI normalizado (sem prefixo https://doi.org/). Pode ser null se inexistente. */
  doi: string | null;
  /** Ano de publicação como string formatada para exibição. */
  displayYear: string;
  /** URL canônica: `originalUrl` sempre presente. */
  originalUrl: string;
}

// ---------------------------------------------------------------------------
// Defaults centralizados — altere aqui para impactar todo o aplicativo
// ---------------------------------------------------------------------------
const DEFAULTS = {
  authors: 'Autor desconhecido',
  displayYear: 'S/D',
  doi: null,
} as const;

// ---------------------------------------------------------------------------
// normalizeArticle
// ---------------------------------------------------------------------------

/**
 * Normaliza um artigo bruto do banco, aplicando defaults consistentes.
 * Elimina a necessidade de `art.authors ?? 'Autor desconhecido'` em cada uso.
 */
export function normalizeArticle(raw: RawArticle): NormalizedArticle {
  const doi = raw.doi
    ? raw.doi.replace(/^https?:\/\/doi\.org\//i, '') // remove prefixo se vier da API
    : DEFAULTS.doi;

  return {
    ...raw,
    authors: raw.authors?.trim() || DEFAULTS.authors,
    doi,
    displayYear: raw.publicationYear?.toString() ?? DEFAULTS.displayYear,
    originalUrl: raw.originalUrl,
  };
}

// ---------------------------------------------------------------------------
// formatArticleReference
// ---------------------------------------------------------------------------

/**
 * Formata uma referência bibliográfica inline no estilo usado pelo LLM context:
 * `[N] Autor (Ano). "Título" — DOI: 10.xxx/yyy`
 *
 * Elimina duplicação em `chat/route.ts` e `synthesis-agent.ts`.
 */
export function formatArticleReference(
  article: NormalizedArticle | RawArticle,
  index: number
): string {
  const norm = 'displayYear' in article ? article : normalizeArticle(article as RawArticle);
  return `[${index}] ${norm.authors} (${norm.displayYear}). "${norm.title}" — DOI: ${norm.doi ?? 'N/A'}`;
}

// ---------------------------------------------------------------------------
// formatArticleDisplayAuthors
// ---------------------------------------------------------------------------

/**
 * Formata os autores para exibição abreviada (primeiros 2 + et al.).
 * Entende tanto `, ` (scraper) quanto `; ` (OpenAlex) como separador.
 */
export function formatDisplayAuthors(authors: string | null | undefined, maxAuthors = 2): string {
  const normalized = authors?.trim() || DEFAULTS.authors;
  if (normalized === DEFAULTS.authors) return normalized;

  const separator = normalized.includes('; ') ? '; ' : ', ';
  const parts = normalized
    .split(separator)
    .map((a) => a.trim())
    .filter(Boolean);

  if (parts.length <= maxAuthors) return parts.join(', ');
  return `${parts.slice(0, maxAuthors).join(', ')} et al.`;
}

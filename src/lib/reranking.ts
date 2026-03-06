/**
 * @file reranking.ts
 * @description Reranking semântico para artigos científicos de Computação e Tecnologia.
 *
 * Implementa o score composto:
 *
 *   S(a) = α·Sem(a) + β·Imp(a) + γ·Rec(a)
 *
 * Fase 2 (ativa): α=0.5, β=0.3, γ=0.2
 *   — Usa similaridade de cosseno entre o embedding do abstract e o da query do usuário,
 *     combinada com citações acadêmicas e recência.
 *   — Artigos sem embedding no banco degradam graciosamente para β·Imp + γ·Rec.
 */

import type { InferSelectModel } from 'drizzle-orm';
import type { articles } from '@/server/db/schema';

export type Article = InferSelectModel<typeof articles>;

// ---------------------------------------------------------------------------
// Configuração de pesos — Fase 2 (com embeddings semânticos ativos)
// ---------------------------------------------------------------------------
const ALPHA = 0.5; // peso semântico  (cosine similarity query ↔ abstract)
const BETA = 0.3; // peso de impacto (citações acadêmicas)
const GAMMA = 0.2; // peso de recência (ano de publicação)

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Teto de normalização para citações.
 * log(1 + 500) ≈ 6.2 — artigos com >500 citações recebem score ≈ 1.
 */
const MAX_CITATIONS_REF = 500;

// ---------------------------------------------------------------------------
// Componentes do score
// ---------------------------------------------------------------------------

/**
 * Similaridade de cosseno entre dois vetores de embedding.
 * Retorna valor em [-1, 1]. Retorna 0 se vetores inválidos.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i]!, 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Score de impacto normalizado [0, 1] via escala logarítmica.
 *
 *   Imp(a) = log(1 + citações) / log(1 + MAX_CITATIONS_REF)
 *
 * Escala logarítmica evita que um artigo com 10.000 citações domine
 * completamente sobre artigos com 50 citações.
 */
export function normalizedImpact(citationCount: number | null): number {
  const c = Math.max(0, citationCount ?? 0);
  return Math.log1p(c) / Math.log1p(MAX_CITATIONS_REF);
}

/**
 * Score de recência [0, 1] decaimento hiperbólico por ano de publicação.
 *
 *   Rec(a) = 1 / (1 + (anoAtual - anoPublicação))
 *
 * Exemplos:
 *   2025 → 1.0   |   2024 → 0.5   |   2020 → 0.17   |   2010 → 0.07
 *
 * Artigos sem ano registrado recebem score 0.
 */
export function recencyScore(publicationYear: number | null): number {
  if (!publicationYear) return 0;
  const age = Math.max(0, CURRENT_YEAR - publicationYear);
  return 1 / (1 + age);
}

// ---------------------------------------------------------------------------
// Parsing de embeddings armazenados
// ---------------------------------------------------------------------------

/**
 * Obtém o embedding do abstract de um artigo.
 * P-19: abstractEmbedding é agora vector(768) — retornado como number[] pelo drizzle-orm.
 * Mantém suporte a string JSON para retrocompatibilidade com dados antigos.
 */
export function parseStoredEmbedding(
  stored: number[] | string | null | undefined
): number[] | undefined {
  if (!stored) return undefined;
  // Caminho pós-migração: drizzle retorna number[] diretamente
  if (Array.isArray(stored)) return stored.length > 0 ? stored : undefined;
  // Retrocompat: campo ainda em formato JSON TEXT
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
  } catch {
    // silently ignore parse errors
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Score composto
// ---------------------------------------------------------------------------

/**
 * Score composto S(a) = α·Sem(a) + β·Imp(a) + γ·Rec(a).
 *
 * @param article          - Artigo a avaliar
 * @param queryEmbedding   - Vetor de embedding da query (Fase 2, opcional)
 * @param articleEmbedding - Vetor de embedding do abstract (Fase 2, opcional)
 * @returns Score em [0, 1]
 */
export function compositeScore(
  article: Article,
  queryEmbedding?: number[],
  articleEmbedding?: number[]
): number {
  const semantic =
    ALPHA > 0 && queryEmbedding && articleEmbedding
      ? cosineSimilarity(queryEmbedding, articleEmbedding)
      : 0;

  const impact = normalizedImpact(article.citationCount);
  const recency = recencyScore(article.publicationYear);

  return ALPHA * semantic + BETA * impact + GAMMA * recency;
}

// ---------------------------------------------------------------------------
// Ranking de listas
// ---------------------------------------------------------------------------

/**
 * Ordena uma lista de artigos pelo score composto (descendente).
 * Substitui o sort ingênuo por citationCount que existia no chat route.
 *
 * Fase 1 (padrão): usa citações + recência (α=0, β=0.6, γ=0.4).
 * Fase 2 (com queryEmbedding): usa também similaridade semântica.
 *   Os embeddings dos artigos são lidos de `article.abstractEmbedding` (JSON string).
 *
 * @param articleList    - Lista de artigos a ordenar
 * @param queryEmbedding - Embedding da query do usuário (Fase 2, opcional)
 * @returns Nova lista ordenada (não muta o original)
 */
export function rankArticles(articleList: Article[], queryEmbedding?: number[]): Article[] {
  return [...articleList].sort((a, b) => {
    const embA = queryEmbedding ? parseStoredEmbedding(a.abstractEmbedding) : undefined;
    const embB = queryEmbedding ? parseStoredEmbedding(b.abstractEmbedding) : undefined;
    return compositeScore(b, queryEmbedding, embB) - compositeScore(a, queryEmbedding, embA);
  });
}

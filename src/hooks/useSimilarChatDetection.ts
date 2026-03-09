'use client';

/**
 * hooks/useSimilarChatDetection.ts
 *
 * FEAT-01: Antes de iniciar uma nova busca, verifica se o utilizador já
 * pesquisou por algo parecido. Usa sobreposição de palavras significativas
 * (word-overlap) entre a query nova e os títulos dos chats recentes.
 *
 * Critério de similaridade:
 *   overlap = words_em_comum / max(palavras_query, palavras_titulo)
 *   threshold: 0.4  (40% de sobreposição)
 *
 * Palavras de parada (stopwords) são ignoradas para evitar falsos positivos.
 */

import type { RecentChat } from '@/server/actions/chat';

// ── Stopwords PT-BR básicas ────────────────────────────────────────────────
const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'e',
  'em',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'no',
  'na',
  'nos',
  'nas',
  'ao',
  'aos',
  'à',
  'às',
  'por',
  'para',
  'com',
  'mas',
  'ou',
  'que',
  'se',
  'não',
  'mais',
  'como',
  'sobre',
  'entre',
  'até',
  'após',
  'isso',
  'este',
  'esta',
  'esse',
  'essa',
  'seu',
  'sua',
  'seus',
  'suas',
  'meu',
  'minha',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúç\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function wordOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  ta.forEach((w) => {
    if (tb.has(w)) common++;
  });
  return common / Math.max(ta.size, tb.size);
}

export interface SimilarChat {
  chat: RecentChat;
  score: number;
}

/** Threshold mínimo de sobreposição para considerar "similares" */
const SIMILARITY_THRESHOLD = 0.4;

/**
 * Encontra o chat mais similar entre os recentes.
 * Retorna null se nenhum estiver acima do threshold.
 */
export function findSimilarChat(
  query: string,
  recentChats: RecentChat[],
  currentChatId?: string
): SimilarChat | null {
  let best: SimilarChat | null = null;

  for (const chat of recentChats) {
    // Ignora o chat atual (já estamos nele)
    if (chat.id === currentChatId) continue;
    const title = chat.title ?? '';
    if (!title) continue;

    const score = wordOverlap(query, title);
    if (score >= SIMILARITY_THRESHOLD) {
      if (!best || score > best.score) {
        best = { chat, score };
      }
    }
  }

  return best;
}

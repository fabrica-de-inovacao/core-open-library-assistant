/**
 * @file reranker-agent.ts
 * @description Agente de reranking semântico via LLM.
 *
 * Complementa o reranking baseado em score composto (reranking.ts):
 * após o ranking inicial por citações + recência, este agente usa um LLM
 * leve para avaliar a relevância semântica de cada artigo em relação ao
 * tópico da pesquisa.
 *
 * Fluxo: rankArticles() → runRerankerAgent() → topK para synthesis-agent
 *
 * Usa 1 única chamada LLM em batch para manter custo baixo.
 */

import { generateText } from 'ai';
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import type { Article } from '@/lib/reranking';

export interface RankedArticle {
  article: Article;
  relevanceScore: number; // 0-10 dado pelo LLM
  reasoning: string;
}

/**
 * Reavalia a relevância de artigos em relação ao tópico usando LLM.
 *
 * @param articles  Lista pre-rankeada pelo score composto (até 25 artigos)
 * @param topic     Tópico da pesquisa em linguagem natural
 * @returns         Lista reordenada por relevância semântica (maior = mais relevante)
 */
export async function runRerankerAgent(articles: Article[], topic: string): Promise<Article[]> {
  if (articles.length === 0) return [];

  // Para listas pequenas, o score composto já é suficiente
  if (articles.length <= 3) return articles;

  const candidates = articles.slice(0, 25); // teto para controle de custo (até 25 artigos)

  console.log(
    `[RerankerAgent] 🔍 Avaliando relevância | artigos=${candidates.length} | topic="${topic.slice(0, 60)}" | model=${getModelIdForTask('reranker')}`
  );

  const articleList = candidates
    .map(
      (art, idx) =>
        `ID_${idx}: "${art.title}" | Palavras-chave: ${art.keywords ?? 'N/A'} | Abstract: ${(art.abstract ?? art.tldrContent ?? '').slice(0, 300)}`
    )
    .join('\n');

  let rerankedIds: number[] = [];

  try {
    const { text } = await generateText({
      model: getModelForTask('reranker'),
      system: `Você é um especialista em revisão sistemática de literatura científica.
Sua tarefa: dado um tópico de pesquisa e uma lista de artigos, ordenar os artigos do MAIS relevante para o MENOS relevante.
Retorne APENAS um array JSON com os índices numéricos (ID_N → N), do mais ao menos relevante.
Exemplo: [2, 0, 4, 1, 3]
Não inclua explicações. Apenas o JSON array.`,
      prompt: `Tópico da pesquisa: "${topic}"

Lista de artigos:
${articleList}

Retorne o array JSON com os índices ordenados por relevância semântica ao tópico:`,
    });

    // Parse do array JSON retornado pelo LLM
    const jsonMatch = text.match(/\[[\d,\s]+\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as number[];
      // Valida os índices
      rerankedIds = parsed.filter((i) => typeof i === 'number' && i >= 0 && i < candidates.length);
    }
  } catch (err) {
    console.warn('[RerankerAgent] ⚠️ Falha no reranking semântico — mantendo ordem original:', err);
    return articles;
  }

  if (rerankedIds.length === 0) {
    console.warn('[RerankerAgent] ⚠️ Array de índices vazio — mantendo ordem original');
    return articles;
  }

  // Reconstrói a lista na nova ordem + adiciona artigos não incluídos no reranking ao final
  const reranked = rerankedIds.map((i) => candidates[i]!);
  const includedIndices = new Set(rerankedIds);
  const remaining = candidates.filter((_, i) => !includedIndices.has(i));

  // Artigos além de candidates (> 15) ficam ao final
  const tail = articles.slice(25);

  console.log(`[RerankerAgent] ✅ Reranking concluído | ${reranked.length} artigos reordenados`);

  return [...reranked, ...remaining, ...tail];
}

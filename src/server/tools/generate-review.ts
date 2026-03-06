/**
 * server/tools/generate-review.ts
 * P-07: Tool execute handler para generate_systematic_review extraído de route.ts.
 */

import { tool, embed } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';
import { rankArticles } from '@/lib/reranking';
import { getEmbeddingModel } from '@/lib/ai-provider';
import { runRerankerAgent } from '@/server/agents/reranker-agent';
import { runSynthesisAgent, type SynthesisDepth } from '@/server/agents/synthesis-agent';
import { formatArticleReference } from '@/lib/mappers/article';
import { logger } from '@/lib/logger';
import type { ToolContext } from './propose-search';

interface ReviewToolContext extends ToolContext {
  /** queryId ativo da request (usado como fallback retrocompat sem chatId) */
  queryId: string | null;
  /**
   * Fase A (IA-01): profundidade de síntese determinada pelo RouterAgent.
   * 'brief'    → 2-3 parágrafos (quick_lookup)
   * 'standard' → TL;DR + Visão Geral + Tabela
   * 'full'     → estrutura canônica completa (systematic_review)
   */
  synthesisDepth?: SynthesisDepth;
}

export function buildGenerateSystematicReviewTool(ctx: ReviewToolContext) {
  return tool({
    description:
      'Gera a revisão bibliográfica consolidada dos artigos já processados na pesquisa. CHAME ESTA FERRAMENTA imediatamente quando o usuário (ou o sistema) solicitar a síntese ou o resumo geral dos artigos encontrados.',
    // P-04 (Fase 1): removido query_id do inputSchema — a tool usa o chatId da closure.
    inputSchema: z.object({
      // Fase C (Batch 4 C-3): modo incremental para análise de novos artigos
      mode: z
        .enum(['full', 'incremental'])
        .optional()
        .describe(
          'Modo de síntese: "incremental" para análise curta de novos artigos (máx. 3 parágrafos), "full" para revisão completa. Omita para usar a profundidade padrão da sessão.'
        ),
    }),
    execute: async (input) => {
      // Fase C (Batch 4 C-3): modo incremental força síntese 'brief' independente do depth da sessão
      const effectiveDepth: SynthesisDepth =
        input.mode === 'incremental' ? 'brief' : (ctx.synthesisDepth ?? 'full');
      logger.info(
        '[Tool] generate_systematic_review | chatId:',
        ctx.chatId,
        '| mode:',
        input.mode ?? 'default',
        '| depth:',
        effectiveDepth
      );

      // Fase 1: busca todos os artigos de todas as queries deste chat
      let finishedArticles: (typeof articles.$inferSelect)[] = [];
      if (ctx.chatId) {
        const chatQueryIds = await db
          .select({ id: searchQueries.id, originalQuery: searchQueries.originalQuery })
          .from(searchQueries)
          .where(eq(searchQueries.chatId, ctx.chatId));

        if (chatQueryIds.length > 0) {
          finishedArticles = await db
            .select()
            .from(articles)
            .where(
              inArray(
                articles.queryId,
                chatQueryIds.map((q) => q.id)
              )
            );
        }
      } else if (ctx.queryId) {
        // Fallback retrocompatível (sem chatId)
        finishedArticles = await db
          .select()
          .from(articles)
          .where(eq(articles.queryId, ctx.queryId));
      }

      const readyArticles = finishedArticles.filter(
        (a) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
      );

      if (readyArticles.length === 0) {
        return {
          success: false,
          message: `Nenhum artigo com TL;DR encontrado. Status atual: ${finishedArticles.map((a) => a.status).join(', ') || 'nenhum'}. O processamento pode ainda estar em andamento — aguarde e tente novamente.`,
        };
      }

      // Fase A (I-01/A-1): ordena por data de criação desc para pegar a query mais recente
      // com originalQuery preenchido (evita pegar query SOL com 0 resultados)
      const topicRows = ctx.chatId
        ? await db
            .select({ originalQuery: searchQueries.originalQuery })
            .from(searchQueries)
            .where(eq(searchQueries.chatId, ctx.chatId))
            .orderBy(desc(searchQueries.createdAt))
        : await db
            .select({ originalQuery: searchQueries.originalQuery })
            .from(searchQueries)
            .where(eq(searchQueries.id, ctx.queryId ?? ''));
      const topic = topicRows.find((q) => q.originalQuery)?.originalQuery ?? '';

      // ✅ Fase 2: gera embedding da query para ranking semântico (α=0.5)
      // gemini-embedding-001 com outputDimensionality:768 — mesmo modelo do pipeline de artigos.
      // Se falhar (quota, timeout), o ranking degrada graciosamente para β·Imp + γ·Rec.
      let queryEmbedding: number[] | undefined;
      if (topic) {
        try {
          const { embedding } = await embed({
            model: getEmbeddingModel(),
            value: topic.slice(0, 2000),
            providerOptions: { google: { outputDimensionality: 768 } },
          });
          queryEmbedding = embedding;
          logger.info(
            `[Tool] 🧮 Query embedding gerado | dims=${embedding.length} | topic="${topic.slice(0, 60)}…"`
          );
        } catch (err) {
          logger.warn(
            '[Tool] ⚠️ Query embedding falhou — ranking sem componente semântico:',
            (err as Error).message
          );
        }
      }

      // ✅ I-04: ranking composto (semântico + citações + recência)
      const initialRanked = rankArticles(readyArticles, queryEmbedding);

      // ✅ I-04: reranker agent (semântico via LLM)
      let finalRanked = initialRanked;
      try {
        finalRanked = await runRerankerAgent(initialRanked, topic);
      } catch (err) {
        logger.warn('[Tool] RerankerAgent falhou, usando ranking composto:', err);
      }

      // ✅ I-04: synthesis agent gera a revisão completa
      try {
        const { review, citationMap, articleCount } = await runSynthesisAgent(
          finalRanked,
          ctx.chatId ?? ctx.queryId ?? 'unknown',
          effectiveDepth,
          ctx.userName ?? undefined
        );
        return {
          success: true,
          total_articles: articleCount,
          review,
          citation_map: citationMap,
          // IDs dos artigos na ordem do reranker semântico — usados pelo frontend
          // para sincronizar a ordenação do acervo com a ordem da síntese (P-ranking-sync)
          ranked_article_ids: finalRanked.map((a) => a.id),
          instruction:
            'A revisão já foi gerada pelo agente de síntese. Apresente o conteúdo do campo "review" VERBATIM ao usuário, sem resumir ou parafrasear. Não adicione texto próprio.',
        };
      } catch (err) {
        logger.error('[Tool] SynthesisAgent falhou, usando fallback LLM:', err);
        // Fallback: retorna instruções para o LLM orquestrador gerar a síntese
        const topK = finalRanked.slice(0, 8);
        const citationMap = topK.map((art, idx) => formatArticleReference(art, idx + 1)).join('\n');
        const articlesContent = topK
          .map((art, idx) => {
            const body = art.markdownContent
              ? art.markdownContent.slice(0, 4000) +
                (art.markdownContent.length > 4000 ? '\n...[TRUNCATED]' : '')
              : `ABSTRACT/TL;DR: ${art.tldrContent}`;
            return `\n=== ARTIGO [${idx + 1}] — "${art.title}" ===\n${body}`;
          })
          .join('\n');
        // Fase A (C-4): fallback LLM responde à profundidade de síntese configurada
        const depth = ctx.synthesisDepth ?? 'full';
        let fallbackInstructions: string;
        if (depth === 'brief') {
          fallbackInstructions = `Gere uma SÍNTESE CONCISA dos artigos em 2-3 parágrafos fluidos (SEM seções, SEM tabelas). Comece com a linha: # 📚 Síntese dos Artigos\n\nCITAÇÕES:\n${citationMap}\n\nARTIGOS:\n${articlesContent}`;
        } else if (depth === 'standard') {
          fallbackInstructions = `Gere a revisão bibliográfica em Markdown com a seguinte estrutura:\n\n# 📚 TL;DR Geral\n(2–3 parágrafos executivos com as principais descobertas)\n\n## Visão Geral e Contexto\n(2–3 parágrafos)\n\n## Tabela Comparativa dos Artigos\n(colunas: Artigo | Ano | Metodologia | Resultado Principal)\n\nEncerre com parágrafo SEM heading convidando o usuário a aprofundar.\n\nCITAÇÕES:\n${citationMap}\n\nARTIGOS:\n${articlesContent}`;
        } else {
          fallbackInstructions = `Gere a revisão bibliográfica em Markdown seguindo a estrutura canônica SOL:\n\n1ª linha: # 📚 TL;DR Geral\nSeções em ##: Visão Geral e Contexto | Estratégias e Iniciativas Detalhadas (com ### subseções por tema) | Tabela Comparativa dos Artigos | Padrões, Divergências, Gaps e Oportunidades de Pesquisa.\nEncerre com parágrafo SEM heading convidando o usuário a aprofundar.\n\nCITAÇÕES:\n${citationMap}\n\nARTIGOS:\n${articlesContent}`;
        }
        return {
          success: true,
          total_articles: topK.length,
          ranked_article_ids: topK.map((a) => a.id),
          synthesis_instructions: fallbackInstructions,
        };
      }
    },
  });
}

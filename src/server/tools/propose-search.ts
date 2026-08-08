/**
 * server/tools/propose-search.ts
 * P-07: Tool execute handlers extraídos de route.ts para manter SRP.
 * Estes módulos são importados pelo route.ts e injetados no streamText.
 */

import { tool, embed } from 'ai';
import { z } from 'zod';
import { desc, eq, ne, and, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';
import { runStrategyAgent } from '@/server/agents/strategy-agent';
import type { SynthesisDepth } from '@/server/agents/synthesis-agent';
import { getEmbeddingModel } from '@/lib/ai-provider';
import { logger } from '@/lib/logger';

/** Artigo retornado pelo RPC match_articles do Supabase (RAG de Cache) */
interface CachedArticleMatch {
  id: string;
  title: string;
  doi: string | null;
  abstract: string | null;
  tldr_content: string | null;
  source_name: string | null;
  publication_year: number | null;
  citation_count: number | null;
  original_url: string;
  similarity: number;
}

const searchSchema = z.object({
  topic: z
    .string()
    .describe(
      'Tópico central da pesquisa em linguagem natural (ex: "gamificação no ensino superior"). O agente de estratégia gerará as strings de busca automaticamente a partir deste tópico.'
    ),
  queries: z
    .array(z.string())
    .default([])
    .describe(
      'Deixe SEMPRE como array vazio []. As queries são geradas automaticamente pelo agente de estratégia a partir do topic.'
    ),
});

/** Contexto injetado pelo route.ts para acesso a userId/chatId da request */
export interface ToolContext {
  sessionUserId: string | null;
  chatId: string | null;
  /** Nome do usuário logado (primeiro nome) — usado na síntese (Prompt 7/8/9) */
  userName?: string | null;
  /** Fase C (Batch 4 C-2): limita número de queries geradas pelo StrategyAgent */
  synthesisDepth?: SynthesisDepth;
}

export function buildProposeSearchSolDatabaseTool(ctx: ToolContext) {
  return tool({
    description:
      'Ferramenta para propor uma pesquisa bibliográfica na SBC OpenLib. Passe APENAS o `topic` em linguagem natural e `queries: []` — o agente de estratégia gera as strings de busca booleanas automaticamente. NÃO gere queries manualmente.',
    inputSchema: searchSchema,
    execute: async (input: z.infer<typeof searchSchema>) => {
      const { queries: rawQueries, topic } = input;
      logger.info(
        `[Tool] propose_search_sol_database | ${rawQueries.length} queries | topic=${topic ?? 'n/a'}`
      );
      logger.debug('[Tool] queries brutas:', rawQueries);

      try {
        // Fase C (IA-04): busca até 3 estratégias anteriores desta sessão para evitar repetição.
        // Filtra 'proposed' (nunca executadas) e usa expandedQuery (já processada pelo StrategyAgent).
        let previousFailedQueries: string[] = [];
        if (ctx.chatId) {
          try {
            const prevRows = await db
              .select({
                expandedQuery: searchQueries.expandedQuery,
                originalQuery: searchQueries.originalQuery,
              })
              .from(searchQueries)
              .where(
                and(eq(searchQueries.chatId, ctx.chatId), ne(searchQueries.status, 'proposed'))
              )
              .orderBy(desc(searchQueries.createdAt))
              .limit(3);
            // Usa expandedQuery quando disponível (é a string real usada na busca)
            previousFailedQueries = prevRows
              .map((r) => r.expandedQuery ?? r.originalQuery ?? '')
              .filter(Boolean);
            if (previousFailedQueries.length > 0) {
              logger.info(
                `[Tool] Histórico de estratégias anteriores: ${previousFailedQueries.length} queries recuperadas`
              );
            }
          } catch (dbErr) {
            logger.warn('[Tool] Falha ao buscar histórico de queries anteriores:', dbErr);
          }
        }

        // I-04: strategy-agent gera todas as queries a partir do topic
        // Fase C (Batch 4 C-2): cap de queries baseado na profundidade de síntese.
        // brief → 1 query (quick_lookup não precisa de múltiplas estratégias)
        // standard → 2 queries
        // full / undefined → sem cap (StrategyAgent decide)
        const maxQueriesOverride =
          ctx.synthesisDepth === 'brief' ? 1 : ctx.synthesisDepth === 'standard' ? 2 : undefined;

        let finalQueries = rawQueries;
        if (topic) {
          try {
            const strategy = await runStrategyAgent(
              topic,
              rawQueries,
              previousFailedQueries,
              maxQueriesOverride
            );
            finalQueries = strategy.queries;
            logger.info(
              `[Tool] StrategyAgent: geradas ${finalQueries.length} queries para tópico "${topic.slice(0, 60)}"`
            );
            logger.debug('[Tool] queries geradas:', finalQueries);
          } catch (err) {
            logger.warn('[Tool] StrategyAgent falhou:', err);
            // Se não havia queries de fallback, propaga o erro
            if (rawQueries.length === 0) throw err;
          }
        }

        const originalCombined = rawQueries.join(' | ');
        const expandedCombined = finalQueries.join(' | ');
        // O LLM sempre passa rawQueries=[] conforme instruído, logo originalCombined seria "".
        // Usa `topic` como fallback para que o Inngest RelevanceGate tenha contexto real.
        const storedOriginalQuery = originalCombined || topic || '';

        // ── Fase 6 (P-seguinte): RAG de Cache + Embedding da Query (1.2.2 + 1.2.3) ──
        // 1. Gera embedding semântico da query para persistência e para pré-busca.
        // 2. Consulta RPC match_articles: artigos similares já na nossa base.
        // 3. Se ≥ 3 artigos relevantes → retorna cache_hit=true ao Orchestrator.
        // Falha no embedding é não-fatal — busca SOL normal prossegue normalmente.
        let queryEmbeddingVec: number[] | undefined;
        let cachedArticles: CachedArticleMatch[] = [];
        if (storedOriginalQuery) {
          try {
            const { embedding } = await embed({
              model: getEmbeddingModel(),
              value: storedOriginalQuery.slice(0, 2000),
              providerOptions: {
                openai: { dimensions: 768 },
                google: { outputDimensionality: 768 },
              },
            });
            queryEmbeddingVec = embedding;
            logger.info(
              `[Tool] 🧮 Query embedding gerado | dims=${embedding.length} | topic="${storedOriginalQuery.slice(0, 60)}…"`
            );

            const embeddingLiteral = JSON.stringify(embedding);
            const matches = await db.execute(sql`
              SELECT
                a.id,
                a.title,
                a.doi,
                a.abstract,
                a.tldr_content,
                a.source_name,
                a.publication_year,
                a.citation_count,
                a.original_url,
                1 - (a.abstract_embedding <=> ${embeddingLiteral}::vector) AS similarity
              FROM articles a
              INNER JOIN search_queries sq ON sq.id = a.query_id
              WHERE
                a.abstract_embedding IS NOT NULL
                AND a.status IN ('done', 'abstract_only')
                AND (${ctx.sessionUserId}::text IS NULL OR sq.user_id = ${ctx.sessionUserId})
                AND 1 - (a.abstract_embedding <=> ${embeddingLiteral}::vector) > 0.75
              ORDER BY a.abstract_embedding <=> ${embeddingLiteral}::vector
              LIMIT 20
            `);

            if (matches.length > 0) {
              cachedArticles = matches as unknown as CachedArticleMatch[];
              logger.info(
                `[Tool] 🗃️ RAG Cache: ${cachedArticles.length} artigos similares na base própria (threshold=0.75)`
              );
            }
          } catch (embedErr) {
            logger.warn(
              '[Tool] ⚠️ Query embedding / RAG cache falhou — busca SOL normal:',
              (embedErr as Error).message
            );
          }
        }

        // ── Detecção de busca similar nas queries anteriores do usuário (1.2.3) ──
        // Compara o embedding da query atual contra queries anteriores do mesmo usuário
        // usando pgvector. Se similarity >= 0.85 → informa o usuário via banner na UI.
        // Falha é não-fatal.
        let similarPreviousQuery: {
          originalQuery: string;
          createdAt: string;
          similarity: number;
        } | null = null;
        if (queryEmbeddingVec && ctx.sessionUserId) {
          try {
            const embeddingLiteral = JSON.stringify(queryEmbeddingVec);
            const rows = await db.execute(sql`
              SELECT original_query, created_at,
                     1 - (query_embedding <=> ${embeddingLiteral}::vector) AS similarity
              FROM search_queries
              WHERE user_id = ${ctx.sessionUserId}
                AND query_embedding IS NOT NULL
              ORDER BY query_embedding <=> ${embeddingLiteral}::vector
              LIMIT 1
            `);
            if (rows.length > 0) {
              const row = rows[0] as {
                original_query: string;
                created_at: string;
                similarity: number;
              };
              const sim = Number(row.similarity);
              if (sim >= 0.85) {
                similarPreviousQuery = {
                  originalQuery: row.original_query,
                  createdAt: row.created_at,
                  similarity: sim,
                };
                logger.info(
                  `[Tool] 🔁 Query similar detectada (${Math.round(sim * 100)}%) — "${row.original_query.slice(0, 60)}"`
                );
              }
            }
          } catch (simErr) {
            logger.warn('[Tool] ⚠️ Detecção de query similar falhou:', (simErr as Error).message);
          }
        }

        const [insertedQuery] = await db
          .insert(searchQueries)
          .values({
            originalQuery: storedOriginalQuery,
            expandedQuery: expandedCombined !== originalCombined ? expandedCombined : null,
            status: 'proposed',
            userId: ctx.sessionUserId,
            chatId: ctx.chatId,
            ...(queryEmbeddingVec ? { queryEmbedding: queryEmbeddingVec } : {}),
          })
          .returning();

        if (!insertedQuery) {
          throw new Error('DB insert retornou vazio');
        }

        return {
          success: true,
          proposed: true,
          query_id: insertedQuery.id,
          queries: finalQueries,
          cache_hit: cachedArticles.length >= 3,
          cached_articles_count: cachedArticles.length,
          // Repassa os artigos em cache ao Orchestrator quando há cache_hit
          // O Orchestrator pode mencioná-los ao usuário antes de iniciar a busca SOL
          cached_articles:
            cachedArticles.length >= 3
              ? cachedArticles.slice(0, 5).map((a) => ({
                  title: a.title,
                  similarity: Math.round(a.similarity * 100),
                  source: a.source_name,
                  year: a.publication_year,
                }))
              : [],
          // Busca similar detectada (1.2.3) — renderiza banner na UI
          similar_query_found: !!similarPreviousQuery,
          similar_query: similarPreviousQuery
            ? {
                topic: similarPreviousQuery.originalQuery,
                date: new Date(similarPreviousQuery.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }),
                similarity: Math.round(similarPreviousQuery.similarity * 100),
              }
            : null,
          message:
            cachedArticles.length >= 3
              ? `Plano de busca montado. ${cachedArticles.length} artigos similares encontrados na base. Apresentado ao usuário para execução.`
              : 'Plano de busca montado e apresentado ao usuário na tela para execução manual.',
        };
      } catch (err) {
        logger.error('[Tool] propose_search_sol_database falhou:', err);
        return {
          success: false,
          proposed: false,
          queries: rawQueries,
          error: `Erro ao salvar proposta: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}

export function buildProposeSearchGlobalDatabaseTool(ctx: ToolContext) {
  return tool({
    description:
      'Propõe uma busca na base científica global OpenAlex. Regras críticas para a query: ' +
      '(1) Retorne uma query OpenAlex-ready, em inglês, com termos acadêmicos internacionais. ' +
      '(2) NÃO use sintaxe booleana: sem AND, OR, NOT, aspas duplas ou parênteses. OpenAlex usa search=full-text simples. ' +
      '(3) Traduza conceitos em português para inglês antes de pesquisar. Ex: "Uso de Inteligência Artificial em Órgãos Públicos" → "artificial intelligence public administration government agencies". ' +
      '(4) Nomes próprios locais em português devem virar conceitos em inglês, não nomes literais. Ex: "Mermãs Digitais" → "digital inclusion women computing education". ' +
      '(5) Use 6 a 12 palavras, sem pontuação desnecessária.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Query OpenAlex-ready em inglês, sem operadores booleanos, sem aspas e sem parênteses. Ex: "artificial intelligence public administration government agencies" ou "digital inclusion women computing education".'
        ),
    }),
    execute: async (input) => {
      const { query: rawQuery } = input;

      // Guarda-corpo: OpenAlex search= não usa sintaxe booleana estilo SOL.
      const query = rawQuery
        .replace(/^'{3}|'{3}$/g, '') // remove ''' do início/fim
        .replace(/^"{3}|"{3}$/g, '') // remove """ do início/fim
        .replace(/^`+|`+$/g, '') // remove backticks externos
        .replace(/["'()]/g, ' ')
        .replace(/\b(AND|OR|NOT)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (query !== rawQuery) {
        logger.warn(
          `[Tool] propose_search_global_database | query sanitizada: "${rawQuery}" → "${query}"`
        );
      }
      logger.info('[Tool] propose_search_global_database | query:', query);

      const [insertedQuery] = await db
        .insert(searchQueries)
        .values({
          originalQuery: query,
          expandedQuery: 'source:openalex', // flag para pular RelevanceGate no Inngest
          status: 'proposed',
          userId: ctx.sessionUserId,
          chatId: ctx.chatId,
        })
        .returning();

      return {
        success: true,
        proposed: true,
        query_id: insertedQuery.id,
        query,
        message: 'Plano de busca Global (OpenAlex) apresentado na tela para execução manual.',
      };
    },
  });
}

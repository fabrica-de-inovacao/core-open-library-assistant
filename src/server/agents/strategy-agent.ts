/**
 * @file strategy-agent.ts
 * @description Agente de planejamento de estratégia de busca bibliográfica.
 *
 * Responsabilidade: expandir um tópico de pesquisa em strings de busca
 * booleanas otimizadas (português + inglês) para a base SOL / OpenAlex.
 *
 * Usado dentro do execute() de propose_search_sol_database para enriquecer
 * as queries antes de apresentá-las ao usuário.
 *
 * Usa o modelo 'strategy' via model routing.
 */

import { generateText } from 'ai';
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import { profileQuery } from '@/server/agents/query-profiler';
import { retrieveUseCaseExamples } from '@/server/agents/use-case-rag';
import { logger } from '@/lib/logger';

export interface StrategyResult {
  queries: string[];
  rationale: string;
}

/**
 * Gera strings de busca booleanas otimizadas para um tópico de pesquisa.
 * @param topic                 Tópico em linguagem natural (ex: "gamificação no ensino superior")
 * @param rawQueries            Queries iniciais sugeridas pelo LLM orquestrador (opcional)
 * @param previousFailedQueries Strings de busca usadas em buscas anteriores desta sessão
 *                              que retornaram poucos resultados — o agente deve evitá-las.
 *                              Fase C (IA-04): evita repetição de estratégias falhas.
 * @returns      Queries refinadas + justificativa
 */
export async function runStrategyAgent(
  topic: string,
  rawQueries: string[] = [],
  previousFailedQueries: string[] = [],
  /** Fase C (Batch 4 C-2): sobrescreve o número máximo de queries geradas */
  maxQueriesOverride?: number
): Promise<StrategyResult> {
  logger.debug(
    `[StrategyAgent] 🗺️  Planejando estratégia | topic="${topic.slice(0, 60)}" | model=${getModelIdForTask('strategy')}`
  );

  // Fase B (IA-02): Profila a query para calibrar o número de strings a gerar.
  const profile = profileQuery(topic);
  // Fase C (Batch 4 C-2): cap externo tem prioridade sobre o perfil da query
  const maxQueries = maxQueriesOverride ?? profile.suggestedQueryCount;
  const profileContext = profile.summary;

  logger.debug(`[StrategyAgent] 🔍 Perfil da query: ${profileContext}`);

  // Fase B (IA-03): Use-Case RAG — recupera exemplos similares como few-shot context
  const fewShotContext = retrieveUseCaseExamples(topic, 2);

  const hasRaw = rawQueries.length > 0;
  const rawSection = hasRaw
    ? `\nQueries iniciais sugeridas (refine se necessário):\n${rawQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : '';

  // Fase C (IA-04): injeta histórico de estratégias falhas para evitar repetição.
  // O agente vê explicitamente o que NÃO funcionou e deve diversificar os termos.
  const failedSection =
    previousFailedQueries.length > 0
      ? `\n\n⚠️ BUSCAS ANTERIORES QUE RETORNARAM POUCOS RESULTADOS (NÃO repita estes termos e estratégias):\n${previousFailedQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}\nDiversifique os termos, use sinônimos alternativos e explore ângulos diferentes do tópico.`
      : '';

  const { text } = await generateText({
    model: getModelForTask('strategy'),
    system: `Você é um especialista em estratégias de busca bibliográfica sistemática (PRISMA/Cochrane).
Sua tarefa: dado um tópico de pesquisa, gerar EXATAMENTE ${maxQueries} string(s) de busca booleana otimizada(s).

REGRAS:
1. Retorne um objeto JSON com duas chaves: "queries" (array de strings) e "rationale" (string explicativa).
2. Gere EXATAMENTE ${maxQueries} quer${maxQueries === 1 ? 'y' : 'ies'} — nem mais, nem menos.
3. Cada query deve combinar termos principais, sinônimos e operadores booleanos AND/OR.
4. Use aspas duplas para termos compostos: ("inteligência artificial") AND (educação OR ensino).
5. ${maxQueries >= 2 ? 'Inclua pelo menos 1 query em português e 1 em inglês.' : 'Gere a query no idioma mais relevante para o tópico (português se o contexto é nacional, inglês se for internacional).'}
6. Não inclua operadores NOT a menos que seja essencial para filtrar ruído conhecido.
7. As queries devem ser compatíveis com SBC OpenLib e OpenAlex.
8. NOMES PRÓPRIOS (projetos, programas, siglas, instituições): PRESERVE-OS exatamente entre aspas duplas — NUNCA os traduza nem acrescente variações OR como tradução. ✅ OK: "Sereias Digitais" AND (educação OR ensino) | ❌ PROIBIDO: "Sereias Digitais" OR "Digital Mermaids" (tradução como OR). Ex. corretos: "ProInfo", "ENEM".
9. Retorne APENAS o JSON. Sem texto extra.`,
    prompt: `Tópico de pesquisa: "${topic}"${rawSection}${failedSection}
${profileContext}${fewShotContext}

Gere as strings de busca booleana otimizadas:`,
  });

  let queries: string[] = rawQueries;
  let rationale = '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { queries?: string[]; rationale?: string };
      if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
        queries = parsed.queries;
      }
      rationale = parsed.rationale ?? '';
    }
  } catch (err) {
    logger.warn('[StrategyAgent] ⚠️ Falha ao parsear JSON — usando queries originais:', err);
  }

  logger.info(`[StrategyAgent] ✅ ${queries.length} queries geradas`);

  return { queries, rationale };
}

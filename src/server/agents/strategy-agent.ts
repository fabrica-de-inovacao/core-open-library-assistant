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
 *
 * v2: usa Output.object (schema mode) para garantir JSON válido, eliminando
 * a contradição "aspas duplas como operador booleano vs aspas duplas como
 * delimitador JSON". Aspas simples passam a ser o operador booleano da query.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import { getUserModel } from '@/server/llm/client';
import { profileQuery } from '@/server/agents/query-profiler';
import { retrieveUseCaseExamples } from '@/server/agents/use-case-rag';
import { logger } from '@/lib/logger';

export interface StrategyResult {
  queries: string[];
}

const strategySchema = z.object({
  queries: z.array(z.string()).min(1).max(5),
});

/**
 * Gera strings de busca booleanas otimizadas para um tópico de pesquisa.
 * @param topic                 Tópico em linguagem natural (ex: "gamificação no ensino superior")
 * @param rawQueries            Queries iniciais sugeridas pelo LLM orquestrador (opcional)
 * @param previousFailedQueries Strings de busca usadas em buscas anteriores desta sessão
 *                              que retornaram poucos resultados — o agente deve evitá-las.
 *                              Fase C (IA-04): evita repetição de estratégias falhas.
 * @param maxQueriesOverride    Sobrescreve o número máximo de queries geradas
 * @returns      Queries refinadas
 */
export async function runStrategyAgent(
  topic: string,
  rawQueries: string[] = [],
  previousFailedQueries: string[] = [],
  maxQueriesOverride?: number,
  userId?: string | null
): Promise<StrategyResult> {
  logger.debug(
    `[StrategyAgent] 🗺️  Planejando estratégia | topic="${topic.slice(0, 60)}" | model=${getModelIdForTask('strategy')}`
  );

  // Fase B (IA-02): Profila a query para calibrar o número de strings a gerar.
  const profile = profileQuery(topic);
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
  const failedSection =
    previousFailedQueries.length > 0
      ? `\n\n⚠️ BUSCAS ANTERIORES QUE RETORNARAM POUCOS RESULTADOS (NÃO repita estes termos e estratégias):\n${previousFailedQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}\nDiversifique os termos, use sinônimos alternativos e explore ângulos diferentes do tópico.`
      : '';

  const { output, finishReason } = await generateText({
    model: userId ? await getUserModel(userId, 'strategy') : getModelForTask('strategy'),
    output: Output.object({ schema: strategySchema }),
    system: `Você é um especialista em estratégias de busca bibliográfica sistemática (PRISMA/Cochrane).
Sua tarefa: dado um tópico de pesquisa, gerar EXATAMENTE ${maxQueries} string(s) de busca otimizada(s) para a SBC OpenLib (SOL).

FRAMEWORK DE DECOMPOSIÇÃO CC/TECNOLOGIA:
Antes de gerar as queries, decompõe mentalmente o tópico em:
  [Conceito central] + [Técnica/Abordagem] + [Contexto de aplicação]
Ex: "redes neurais" + "transfer learning" + "ensino superior"
Use essa decomposição para garantir cobertura semântica ampla e termos precisos.

REGRAS CRÍTICAS — FORMATO DAS STRINGS DE BUSCA BOOLEANA PARA O SOL:
1. Retorne um objeto JSON com uma chave: "queries" (array de strings). Não inclua outros campos.
2. Gere EXATAMENTE ${maxQueries} quer${maxQueries === 1 ? 'y' : 'ies'} — nem mais, nem menos.
3. USE operadores booleanos — o motor OJS do SOL os suporta: AND, OR, NOT e parênteses. Escreva-os SEMPRE em MAIÚSCULAS. Ex: ("ensino superior" OR "educação superior") AND "inteligência artificial".
4. Coloque SEMPRE frases compostas entre aspas duplas: "machine learning", "ensino médio", "redes neurais". Termos simples não precisam de aspas. O sistema de schema valida o JSON — as aspas duplas dentro das strings serão escapadas automaticamente (\\").
5. Estrutura recomendada: ("termo principal" OR sinônimo) AND ("contexto" OR "area"). Agrupe sinônimos com OR dentro de parênteses; combine conceitos distintos com AND.
6. ${maxQueries >= 2 ? 'Gere pelo menos 1 query em português e 1 em inglês para maximizar o recall.' : 'Gere a query no idioma mais relevante para o tópico (português para contexto nacional, inglês para internacional).'}
7. NOMES PRÓPRIOS (projetos, programas, siglas, instituições): PRESERVE-OS exatamente entre aspas duplas — NUNCA os traduza nem acrescente variações. ✅ OK: "Mermãs Digitais" AND ("inclusão digital" OR "educação") | ❌ PROIBIDO: "Mermãs Digitais" OR "Digital Mermaids".
8. Prefira termos específicos ao tópico; evite stopwords e termos genéricos demais.
9. Antes de gerar o JSON, identifique o conceito central, seus sinônimos e o contexto — depois monte a estrutura booleana e gere o JSON.
10. Retorne APENAS o JSON. Sem texto extra fora do objeto JSON.`,
    prompt: `Tópico de pesquisa: "${topic}"${rawSection}${failedSection}
${profileContext}${fewShotContext}

Gere as strings de busca booleana otimizadas:`,
  });

  // Schema mode garante output tipado. Se falhar (provider sem suporte), usa rawQueries.
  if (output && Array.isArray(output.queries) && output.queries.length > 0) {
    logger.info(`[StrategyAgent] ✅ ${output.queries.length} queries geradas (schema mode)`);
    return { queries: output.queries };
  }

  logger.warn(
    `[StrategyAgent] ⚠️ Schema mode sem output válido (finishReason=${finishReason}) — usando queries originais`
  );
  return { queries: rawQueries };
}

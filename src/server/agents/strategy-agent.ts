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
Sua tarefa: dado um tópico de pesquisa, gerar EXATAMENTE ${maxQueries} string(s) de busca otimizada(s) para a SBC OpenLib (SOL).

FRAMEWORK DE DECOMPOSIÇÃO CC/TECNOLOGIA:
Antes de gerar as queries, decompõe mentalmente o tópico em:
  [Conceito central] + [Técnica/Abordagem] + [Contexto de aplicação]
Ex: "redes neurais" + "transfer learning" + "ensino superior"
Use essa decomposição para garantir cobertura semântica ampla e termos precisos.

REGRAS CRÍTICAS — COMPATIBILIDADE COM O MOTOR OJS DO SOL:
1. Retorne um objeto JSON com uma chave: "queries" (array de strings). Não inclua outros campos.
2. Gere EXATAMENTE ${maxQueries} quer${maxQueries === 1 ? 'y' : 'ies'} — nem mais, nem menos.
3. PROIBIDO usar operadores booleanos (AND, OR, NOT) e parênteses aninhados. O motor OJS do SOL não os suporta confiávelmente e pode ignorar ou misinterpretar a sintaxe complexa.
4. Use aspas duplas APENAS para termos compostos que devem aparecer juntos: "inteligência artificial" "ensino superior". Múltiplas frases entre aspas na mesma query são permitidas e funcionam como AND implícito no OJS.
5. Combine termos simplesmente por adjacência (espaço = busca por todos os termos): "machine learning" educação computação.
6. ${maxQueries >= 2 ? 'Gere pelo menos 1 query em português e 1 em inglês para maximizar o recall.' : 'Gere a query no idioma mais relevante para o tópico (português para contexto nacional, inglês para internacional).'}
7. NOMES PRÓPRIOS (projetos, programas, siglas, instituições): PRESERVE-OS exatamente entre aspas duplas — NUNCA os traduza nem acrescente variações. ✅ OK: "Mermãs Digitais" inclusão digital | ❌ PROIBIDO: "Mermãs Digitais" OR "Digital Mermaids".
8. Prefira termos específicos ao tópico; evite stopwords e termos genéricos demais.
9. Antes de gerar o JSON, pense nos termos-chave, nos sinônimos disponíveis e na cobertura temática — depois gere o JSON.
10. Retorne APENAS o JSON. Sem texto extra fora do objeto JSON.`,
    prompt: `Tópico de pesquisa: "${topic}"${rawSection}${failedSection}
${profileContext}${fewShotContext}

Gere as strings de busca booleana otimizadas:`,
  });

  let queries: string[] = rawQueries;

  try {
    const startIdx = text.indexOf('{');
    if (startIdx !== -1) {
      let depth = 0;
      let jsonStr = '';
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            jsonStr = text.substring(startIdx, i + 1);
            break;
          }
        }
      }

      if (jsonStr) {
        const parsed = JSON.parse(jsonStr) as { queries?: string[] };
        if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
          queries = parsed.queries;
        }
      }
    }
  } catch (err) {
    logger.warn('[StrategyAgent] ⚠️ Falha ao parsear JSON — usando queries originais:', err);
  }

  logger.info(`[StrategyAgent] ✅ ${queries.length} queries geradas`);

  return { queries };
}

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

export interface StrategyResult {
  queries: string[];
  rationale: string;
}

/**
 * Gera strings de busca booleanas otimizadas para um tópico de pesquisa.
 * @param topic  Tópico em linguagem natural (ex: "gamificação no ensino superior")
 * @param rawQueries  Queries iniciais sugeridas pelo LLM orquestrador (opcional)
 * @returns      Queries refinadas + justificativa
 */
export async function runStrategyAgent(
  topic: string,
  rawQueries: string[] = []
): Promise<StrategyResult> {
  console.log(
    `[StrategyAgent] 🗺️  Planejando estratégia | topic="${topic.slice(0, 60)}" | model=${getModelIdForTask('strategy')}`
  );

  const hasRaw = rawQueries.length > 0;
  const rawSection = hasRaw
    ? `\nQueries iniciais sugeridas (refine se necessário):\n${rawQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : '';

  const { text } = await generateText({
    model: getModelForTask('strategy'),
    system: `Você é um especialista em estratégias de busca bibliográfica sistemática (PRISMA/Cochrane).
Sua tarefa: dado um tópico de pesquisa, gerar entre 2 e 4 strings de busca booleana otimizadas.

REGRAS:
1. Retorne um objeto JSON com duas chaves: "queries" (array de strings) e "rationale" (string explicativa).
2. Cada query deve combinar termos principais, sinônimos e operadores booleanos AND/OR.
3. Use aspas duplas para termos compostos: ("inteligência artificial") AND (educação OR ensino).
4. Inclua pelo menos 1 query em português e 1 em inglês.
5. Não inclua operadores NOT a menos que seja essencial para filtrar ruído conhecido.
6. As queries devem ser compatíveis com SBC OpenLib e OpenAlex.
7. Retorne APENAS o JSON. Sem texto extra.`,
    prompt: `Tópico de pesquisa: "${topic}"${rawSection}

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
    console.warn('[StrategyAgent] ⚠️ Falha ao parsear JSON — usando queries originais:', err);
  }

  console.log(`[StrategyAgent] ✅ Estratégia definida | ${queries.length} queries geradas`);

  return { queries, rationale };
}

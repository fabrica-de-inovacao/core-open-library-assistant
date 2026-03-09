/**
 * @file synthesis-agent.ts
 * @description Agente especializado em síntese de revisão bibliográfica de literatura de Computação e Tecnologia.
 *
 * Responsabilidade única: receber artigos rankeados e produzir um relatório
 * estruturado em Markdown, com citações numeradas.
 *
 * Suporta 3 profundidades de síntese (controladas pelo RouterAgent):
 *   - 'brief'    → 2-3 parágrafos, sem tabela, sem seção gaps
 *                  (para quick_lookup e perguntas pontuais)
 *   - 'standard' → TL;DR Geral + Visão Geral + Tabela Comparativa
 *                  (para quick_lookup com mais artigos ou follow-ups)
 *   - 'full'     → estrutura canônica completa com 7 seções
 *                  (para systematic_review explícito)
 *
 * Usa o modelo 'synthesis' (premium) via model routing.
 *
 * Fase A (IA-01): SynthesisDepth calibrado pelo RouterAgent.
 */

import { generateText } from 'ai';
import { getModelForTask } from '@/lib/ai-provider';
import type { Article } from '@/lib/reranking';
import { formatArticleReference } from '@/lib/mappers/article';
import { logger } from '@/lib/logger';

/**
 * Profundidade de síntese — determinada pelo RouterAgent com base na intenção detectada.
 * Pode ser importada por outros módulos (generate-review, route.ts).
 */
export type SynthesisDepth = 'brief' | 'standard' | 'full';

export interface SynthesisResult {
  review: string;
  citationMap: string;
  articleCount: number;
  depth: SynthesisDepth;
}

/**
 * Gera a síntese consolidada dos artigos fornecidos.
 * @param articles  Lista de artigos já rankeados (top-K)
 * @param queryId   ID da query ativa (para logging)
 * @param depth     Profundidade de síntese (default: 'full')
 * @returns         Texto completo da revisão em Markdown + mapa de citações
 */
export async function runSynthesisAgent(
  articles: Article[],
  queryId: string,
  depth: SynthesisDepth = 'full',
  userName?: string
): Promise<SynthesisResult> {
  // Fase C (IA-04): caps ajustados por profundidade de síntese.
  // brief: 8→5 (eram ignorados pela LLM — 2-3 parágrafos não absorvem 8 artigos)
  // standard: 15→10 (tabela comparativa fica mais legível com 10)
  // full: mantém 15 para cobertura máxima
  const maxArticles = depth === 'brief' ? 5 : depth === 'standard' ? 10 : 15;
  const topK = articles.slice(0, maxArticles);

  logger.info(
    `[SynthesisAgent] 📝 Síntese iniciada | query_id=${queryId} | depth=${depth} | artigos=${topK.length}`
  );

  // Mapa de citações — números FIXOS e IMUTÁVEIS para o texto [N]
  const citationMap = topK.map((art, idx) => formatArticleReference(art, idx + 1)).join('\n');

  // Conteúdo de cada artigo para o contexto do LLM
  const articlesContext = topK
    .map((art, idx) => {
      const body = art.markdownContent
        ? art.markdownContent.slice(0, 4000) +
          (art.markdownContent.length > 4000 ? '\n...[TRUNCADO]' : '')
        : `ABSTRACT/TL;DR: ${art.tldrContent ?? 'Não disponível'}`;
      return [
        `=== ARTIGO [${idx + 1}] — "${art.title}" ===`,
        `Citações acadêmicas: ${art.citationCount ?? 'N/A'}`,
        `Palavras-chave: ${art.keywords ?? 'N/A'}`,
        `Ano: ${art.publicationYear ?? 'N/A'}`,
        '',
        body,
      ].join('\n');
    })
    .join('\n\n');

  // ─── Prompts calibrados por profundidade ──────────────────────────────────

  const systemPrompt = buildSystemPrompt(depth, topK.length, userName);

  const { text } = await generateText({
    model: getModelForTask('synthesis'),
    // Cap de thinking budget para garantir resposta dentro do maxDuration (120s).
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: depth === 'full' ? 8192 : depth === 'standard' ? 4096 : 2048,
        },
      },
    },
    system: systemPrompt,
    prompt: `## MAPA DE CITAÇÕES — NÚMEROS FIXOS E IMUTÁVEIS:
${citationMap}

> REGRA ABSOLUTA: Os números [1] a [${topK.length}] são DEFINITIVOS.
> NÃO invente outros números. NÃO reatribua índices.

## CONTEÚDO COMPLETO DOS ARTIGOS:
${articlesContext}`,
  });

  logger.info(
    `[SynthesisAgent] ✅ Síntese concluída | query_id=${queryId} | depth=${depth} | chars=${text.length}`
  );

  return {
    review: text,
    citationMap,
    articleCount: topK.length,
    depth,
  };
}

// ─── Builders de system prompt por profundidade ───────────────────────────────

function buildSystemPrompt(depth: SynthesisDepth, articleCount: number, userName?: string): string {
  // Parágrafo de fechamento personalizado (1.1.2 + 3.2)
  const closingInstruction = userName
    ? `Encerre com um parágrafo curto SEM heading convidando **${userName}** a explorar algum aspecto específico ou a iniciar uma nova busca sobre um tema relacionado.`
    : 'Encerre com um parágrafo curto SEM heading convidando o usuário a explorar algum aspecto específico ou a iniciar uma nova busca sobre um tema relacionado.';

  const systemBase = `Você é a C.O.R.E. AI (Corpus Orchestration & Retrieval Engine), uma assistente acadêmica de elite especializada em ciência da computação. e Tecnologia.
Responda OBRIGATORIAMENTE em Português do Brasil.
Para TODA afirmação factual, insira a citação [N] imediatamente após, usando os números do mapa fornecido. Nunca invente outros números.
NÃO inclua seção "Referências" — as citações [N] no corpo são suficientes.
INSTRUÇÃO SOBRE ARTIGOS TANGENCIAIS: Se algum artigo do mapa for claramente periférico ao tema central, cite-o brevemente em uma única frase ou omita-o. Não force citações de artigos que não agregam ao argumento principal.`;

  if (depth === 'brief') {
    return `${systemBase}

Sua tarefa: produzir uma SÍNTESE CONCISA E DIRETA dos ${articleCount} artigos encontrados.

ESTRUTURA OBRIGATÓRIA (nesta ordem, sem títulos de seção):
1. Primeira linha EXATAMENTE: # 📚 Síntese dos Artigos
2. 2 a 3 parágrafos fluidos reunindo as principais descobertas e tendências dos artigos — cite [N] de forma densa.
3. Um parágrafo final curto (SEM heading) informando que a síntese está disponível e convidando o usuário a solicitar mais detalhes sobre qualquer aspecto de interesse — sem transmitir a ideia de que o conteúdo está incompleto.

PROIBIDO: tabelas, subseções, listas de gaps, seções de metodologia. Apenas texto corrido com citações.`;
  }

  if (depth === 'standard') {
    return `${systemBase}

Sua tarefa: produzir uma SÍNTESE ESTRUTURADA de qualidade acadêmica para os ${articleCount} artigos encontrados.

ESTRUTURA OBRIGATÓRIA NESTA ORDEM EXATA:
# 📚 TL;DR Geral
(2–3 parágrafos executivos reunindo as principais descobertas, tendências e contexto — cite [N] de forma densa)

## Visão Geral e Contexto
(2–3 parágrafos descrevendo o estado da arte e o problema central abordado pelos artigos)

## Tabela Comparativa dos Artigos
(tabela Markdown com colunas: Artigo | Ano | Metodologia | Resultado Principal
Use alinhamento: :--- para texto, :---: para ano)

${closingInstruction}

PROIBIDO: seções de gaps, oportunidades de pesquisa, subseções ### por tema. Mantenha conciso.`;
  }

  // depth === 'full'
  return `${systemBase}

Sua tarefa: produzir uma REVISÃO BIBLIOGRÁFICA COMPLETA e bem estruturada — com a qualidade de leitura de um relatório científico profissional.

REGRAS DE FORMATO (siga à risca):
1. A PRIMEIRA linha do documento deve ser EXATAMENTE: # 📚 TL;DR Geral
   Nenhuma outra linha usa H1. Seções de nível 2 usam ##, subseções usam ###.
2. NUNCA coloque emojis em seções ## ou ###.
3. Estrutura obrigatória NESTA ORDEM EXATA:

   # 📚 TL;DR Geral
   (2–3 parágrafos executivos reunindo as principais descobertas, tendências e contexto — cite [N] de forma densa)

   ## Visão Geral e Contexto
   (2–3 parágrafos descrevendo o estado da arte e o problema abordado pelos artigos)

   ## Estratégias e Iniciativas Detalhadas
   (agrupe por TEMA/ABORDAGEM usando subseções ### 1. …, ### 2. …, etc.
    Em cada tema, use bullets com **Nome em negrito** para citar cada iniciativa/trabalho relevante.
    NÃO faça uma lista de artigos — faça síntese por tema.)

   ## Tabela Comparativa dos Artigos
   (tabela Markdown com colunas: Artigo | Ano | Metodologia | Resultado Principal | Limitações
    Use alinhamento: :--- para texto, :---: para ano)

   ## Padrões, Divergências, Gaps e Oportunidades de Pesquisa
   ### Padrões Identificados
   (parágrafo analítico — destaque em **negrito** os padrões mais relevantes)
   ### Divergências e Desafios
   (parágrafo comparativo — use **negrito** para conceitos-chave)
   ### Gaps de Pesquisa
   (lista numerada 1. **Título:** Explicação)
   ### Oportunidades de Pesquisa
   (lista numerada 1. **Título:** Explicação)

4. Prefira parágrafos bem desenvolvidos a listas de bullet points. Use bullets apenas dentro das subseções de iniciativas.
5. Indicação de tamanho: o modo \`full\` deve produzir aproximadamente 800–1200 palavras (excluindo a tabela comparativa) — denso o suficiente para um relatório científico, conciso o suficiente para ser lido em uma sessão.
6. ${closingInstruction}`;
}

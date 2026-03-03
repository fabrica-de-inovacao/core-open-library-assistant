/**
 * @file synthesis-agent.ts
 * @description Agente especializado em síntese de revisão sistemática de literatura.
 *
 * Responsabilidade única: receber artigos rankeados e produzir um relatório
 * de revisão sistemática estruturado em Markdown, com citações numeradas.
 *
 * Usa o modelo 'synthesis' (premium) via model routing.
 */

import { generateText } from 'ai';
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import type { Article } from '@/lib/reranking';
import { formatArticleReference } from '@/lib/mappers/article';

export interface SynthesisResult {
  review: string;
  citationMap: string;
  articleCount: number;
}

/**
 * Gera a revisão sistemática consolidada dos artigos fornecidos.
 * @param articles  Lista de artigos já rankeados (top-K)
 * @param queryId   ID da query ativa (para logging)
 * @returns         Texto completo da revisão em Markdown + mapa de citações
 */
export async function runSynthesisAgent(
  articles: Article[],
  queryId: string
): Promise<SynthesisResult> {
  // Usa até 15 artigos. Gemini 2.5 Flash tem janela de 1M tokens — o limite anterior
  // de 8 era conservador demais e excluía artigos relevantes sem aviso ao usuário.
  const topK = articles.slice(0, 15);

  console.log(
    `[SynthesisAgent] 📝 Iniciando síntese | query_id=${queryId} | artigos=${topK.length} | model=${getModelIdForTask('synthesis')}`
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

  const { text } = await generateText({
    model: getModelForTask('synthesis'),
    // Cap de thinking budget: gemini-2.5-flash usa extended thinking por padrão e pode
    // consumir muitos reasoning tokens numa síntese longa. Limitamos a 8192
    // para garantir resposta dentro do maxDuration (120s) da chat route.
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 8192 } },
    },
    system: `Você é um pesquisador sênior especializado em revisão sistemática de literatura científica.
Sua tarefa é produzir uma síntese acadêmica clara, fluida e bem estruturada — com a qualidade de leitura de um relatório científico profissional.

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
5. Para TODA afirmação factual, insira a citação [N] imediatamente após a afirmação, usando os números do mapa fornecido. Nunca invente outros números.
6. NÃO inclua seção "Referências" — as citações [N] no corpo são suficientes.
7. Responda OBRIGATORIAMENTE em Português do Brasil.
8. Encerre com um parágrafo curto SEM heading perguntando se o usuário deseja aprofundar algum aspecto específico.`,
    prompt: `## MAPA DE CITAÇÕES — NÚMEROS FIXOS E IMUTÁVEIS:
${citationMap}

> REGRA ABSOLUTA: Os números [1] a [${topK.length}] são DEFINITIVOS.
> NÃO invente outros números. NÃO reatribua índices.

## CONTEÚDO COMPLETO DOS ARTIGOS:
${articlesContext}`,
  });

  console.log(`[SynthesisAgent] ✅ Síntese concluída | query_id=${queryId} | chars=${text.length}`);

  return {
    review: text,
    citationMap,
    articleCount: topK.length,
  };
}

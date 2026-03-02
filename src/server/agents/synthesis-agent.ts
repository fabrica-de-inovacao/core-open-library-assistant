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
  const topK = articles.slice(0, 8);

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
    system: `Você é um pesquisador sênior especializado em revisão sistemática de literatura científica.
Sua tarefa é produzir uma síntese acadêmica rigorosa e bem estruturada em Markdown.

REGRAS ABSOLUTAS:
1. Inicie EXATAMENTE com "# 📚 TL;DR Geral" como primeira linha.
2. Use Markdown rico: ##, ###, **negrito**, *itálico*, listas, tabelas.
3. Inclua OBRIGATORIAMENTE uma tabela comparativa com colunas: Artigo | Ano | Metodologia | Resultado Principal | Limitações.
4. Para TODA afirmação factual, insira a citação [N] imediatamente após, usando os números do mapa de citações.
5. Identifique padrões, divergências, gaps e oportunidades de pesquisa.
6. NÃO inclua seção "Referências" no final — as citações [N] no texto são suficientes.
7. Responda OBRIGATORIAMENTE em Português do Brasil.
8. Encerre com 1 parágrafo perguntando se o usuário deseja aprofundar algum ponto.`,
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

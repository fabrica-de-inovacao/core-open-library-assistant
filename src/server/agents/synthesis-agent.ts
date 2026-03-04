/**
 * @file synthesis-agent.ts
 * @description Agente especializado em síntese de revisão sistemática de literatura.
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
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import type { Article } from '@/lib/reranking';
import { formatArticleReference } from '@/lib/mappers/article';

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
  depth: SynthesisDepth = 'full'
): Promise<SynthesisResult> {
  // Ajusta top-K por profundidade: brief usa menos artigos (mais foco)
  const maxArticles = depth === 'brief' ? 8 : 15;
  const topK = articles.slice(0, maxArticles);

  console.log(
    `[SynthesisAgent] 📝 Iniciando síntese | query_id=${queryId} | depth=${depth} | artigos=${topK.length} | model=${getModelIdForTask('synthesis')}`
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

  const systemPrompt = buildSystemPrompt(depth, topK.length);

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

  console.log(
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

function buildSystemPrompt(depth: SynthesisDepth, articleCount: number): string {
  const base = `Você é um pesquisador sênior especializado em revisão sistemática de literatura científica.
Responda OBRIGATORIAMENTE em Português do Brasil.
Para TODA afirmação factual, insira a citação [N] imediatamente após, usando os números do mapa fornecido. Nunca invente outros números.
NÃO inclua seção "Referências" — as citações [N] no corpo são suficientes.`;

  if (depth === 'brief') {
    return `${base}

Sua tarefa: produzir uma SÍNTESE CONCISA E DIRETA dos ${articleCount} artigos encontrados.

ESTRUTURA OBRIGATÓRIA (nesta ordem, sem títulos de seção):
1. Primeira linha EXATAMENTE: # 📚 Síntese dos Artigos
2. 2 a 3 parágrafos fluidos reunindo as principais descobertas e tendências dos artigos — cite [N] de forma densa.
3. Um parágrafo final curto (SEM heading) perguntando se o usuário quer aprofundar algum aspecto ou realizar uma revisão completa.

PROIBIDO: tabelas, subseções, listas de gaps, seções de metodologia. Apenas texto corrido com citações.`;
  }

  if (depth === 'standard') {
    return `${base}

Sua tarefa: produzir uma SÍNTESE ESTRUTURADA de qualidade acadêmica para os ${articleCount} artigos encontrados.

ESTRUTURA OBRIGATÓRIA NESTA ORDEM EXATA:
# 📚 TL;DR Geral
(2–3 parágrafos executivos reunindo as principais descobertas, tendências e contexto — cite [N] de forma densa)

## Visão Geral e Contexto
(2–3 parágrafos descrevendo o estado da arte e o problema central abordado pelos artigos)

## Tabela Comparativa dos Artigos
(tabela Markdown com colunas: Artigo | Ano | Metodologia | Resultado Principal
Use alinhamento: :--- para texto, :---: para ano)

Encerre com um parágrafo curto SEM heading perguntando se o usuário deseja a revisão completa com análise de gaps e oportunidades de pesquisa.

PROIBIDO: seções de gaps, oportunidades de pesquisa, subseções ### por tema. Mantenha conciso.`;
  }

  // depth === 'full'
  return `${base}

Sua tarefa: produzir uma REVISÃO SISTEMÁTICA COMPLETA e bem estruturada — com a qualidade de leitura de um relatório científico profissional.

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
5. Encerre com um parágrafo curto SEM heading perguntando se o usuário deseja aprofundar algum aspecto específico.`;
}

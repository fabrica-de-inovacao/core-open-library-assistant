/**
 * @file query-profiler.ts
 * @description Perfilador heurístico de queries — analisa a estrutura lexical
 * de um tópico de pesquisa para determinar complexidade e parâmetros ótimos
 * de geração de strings booleanas.
 *
 * Completamente determinístico: ZERO custo LLM, execução < 1ms.
 *
 * Usado pelo StrategyAgent para calibrar quantas queries gerar e se deve
 * priorizar a base SOL, OpenAlex, ou ambas.
 *
 * Fase B (IA-02): QueryProfiler heurístico.
 *
 * Referências:
 * - PICO Framework (Patient, Intervention, Comparison, Outcome) — usado em systematic reviews
 * - Scopus AI Query Understanding (Elsevier, 2024)
 */

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type QueryComplexity = 'simple' | 'moderate' | 'broad';

export interface QueryProfile {
  /** Complexidade inferida da query */
  complexity: QueryComplexity;
  /** Número recomendado de strings booleanas a gerar (1-4) */
  suggestedQueryCount: 1 | 2 | 3 | 4;
  /**
   * Quando true, o tópico contém nomes próprios em Português que provavelmente
   * não aparecem em bases internacionais → priorizar SOL sobre OpenAlex.
   */
  hasBrazilianProperNouns: boolean;
  /**
   * Quando true, o tópico é intrinsecamente internacional (termos já em inglês
   * ou conceitos universais) → OpenAlex pode trazer mais resultados.
   */
  prefersGlobalSearch: boolean;
  /** Estimativa do número de conceitos distintos na query */
  conceptCount: number;
  /** Resumo legível do perfil para injeção no prompt do StrategyAgent */
  summary: string;
}

// ─── Heurísticas ─────────────────────────────────────────────────────────────

// Indicadores de alta especificidade (query simples, 1-2 strings bastam)
const SPECIFIC_INDICATORS = [
  /\b(bert|gpt|llm|transformer|lstm|cnn|rnn|gan|vae)\b/i,
  /\b(react|angular|vue|nextjs|nodejs|pytorch|tensorflow|keras)\b/i,
  /\b(doi:\S+)/i,
  // Autor + ano: "smith 2020", "lecun et al"
  /\b[a-záàãâéêíóôõúç]+ et al\b/i,
];

// Indicadores de nome próprio brasileiro (projetos, programas, siglas nacionais)
const BRAZILIAN_PROPER_NOUN_PATTERNS = [
  /\b(proinfo|enem|fies|sisu|prouni|pibid|capes|cnpq|fapesp|fnde)\b/i,
  /\b(brasil|brasileiro|brasileira|nacional|federal|municipal|estadual)\b/i,
  /\bcurso[s]? (de|em|para)\b/i,
  // Palavras exclusivamente em português sem equivalente direto
  /\b(letramento|alfabetização|ensino médio|ensino fundamental|educação básica)\b/i,
  // Nomes próprios com acento (geralmente portugueses)
  /[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõú]{3,}/,
];

// Indicadores de tópico amplo/multidimensional (precisa de mais queries)
const BROAD_INDICATORS = [
  /\b(e a?|e o?|e as?|e os?)\b.*\b(e a?|e o?|e as?|e os?)\b/i, // múltiplos "e" → multi-conceito
  /\b(impact[oa]|efeito|influência|relação entre|correlação)\b/i,
  /\b(revisão|mapeamento|panorama|análise de|survey)\b/i,
  /\b(tendências|desafios|oportunidades|perspectivas)\b/i,
];

// Indicadores de contexto estritamente internacional / em inglês
const INTERNATIONAL_INDICATORS = [
  /\b(machine learning|deep learning|artificial intelligence|natural language processing)\b/i,
  /\b(blockchain|cloud computing|internet of things|iot|devops|microservices)\b/i,
  // Query já completamente em inglês
  /^[a-z0-9\s\-_()'"]+$/i,
];

// ─── Algoritmo de perfilagem ─────────────────────────────────────────────────

/**
 * Analisa um tópico de pesquisa e retorna um perfil de complexidade.
 * @param topic  Tópico em linguagem natural
 */
export function profileQuery(topic: string): QueryProfile {
  const normalized = topic.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // ── Detecção de nomes próprios brasileiros ────────────────────────────────
  const hasBrazilianProperNouns = BRAZILIAN_PROPER_NOUN_PATTERNS.some((p) => p.test(topic));

  // ── Detecção de contexto internacional ───────────────────────────────────
  const prefersGlobalSearch =
    !hasBrazilianProperNouns &&
    (INTERNATIONAL_INDICATORS.some((p) => p.test(normalized)) ||
      // Query puramente em inglês (sem caracteres acentuados)
      !/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/.test(topic));

  // ── Detecção de especificidade ────────────────────────────────────────────
  const isSpecific = SPECIFIC_INDICATORS.some((p) => p.test(normalized));

  // ── Contagem de conceitos (heurística) ───────────────────────────────────
  // Separadores de conceitos: vírgulas, "e", "ou", ":", dois-pontos, parênteses
  const conceptSeparators = (topic.match(/[,;:]|\s+(e|ou|and|or)\s+/gi) ?? []).length;
  const conceptCount = Math.max(1, Math.min(conceptSeparators + 1, 6));

  // ── Determinação de complexidade ─────────────────────────────────────────
  let complexity: QueryComplexity;
  let suggestedQueryCount: 1 | 2 | 3 | 4;

  if (isSpecific || wordCount <= 4) {
    complexity = 'simple';
    suggestedQueryCount = 1;
  } else if (
    BROAD_INDICATORS.some((p) => p.test(normalized)) ||
    conceptCount >= 3 ||
    wordCount >= 15
  ) {
    complexity = 'broad';
    suggestedQueryCount = 4;
  } else {
    complexity = 'moderate';
    suggestedQueryCount = conceptCount >= 2 ? 3 : 2;
  }

  // ── Resumo para prompt ────────────────────────────────────────────────────
  const flags: string[] = [
    `complexity=${complexity}`,
    `suggested_queries=${suggestedQueryCount}`,
    conceptCount > 1 ? `concepts=${conceptCount}` : '',
    hasBrazilianProperNouns ? 'has_pt_proper_nouns=true' : '',
    prefersGlobalSearch ? 'prefers_global=true' : '',
  ].filter(Boolean);

  const summary = `[QueryProfile: ${flags.join(' | ')}]`;

  return {
    complexity,
    suggestedQueryCount,
    hasBrazilianProperNouns,
    prefersGlobalSearch,
    conceptCount,
    summary,
  };
}

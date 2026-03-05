/**
 * @file use-case-rag.ts
 * @description Use-Case RAG — recupera exemplos canônicos de estratégias de busca
 * para injetar como few-shot context no StrategyAgent.
 *
 * V1 (Fase B — IA-03): Exemplos estáticos curados manualmente.
 *   - Zero custo LLM, zero latência de DB.
 *   - Cobertura: 8 domínios de pesquisa frequentes na SOL.
 *
 * V2 (Fase Futura): Retrieval dinâmico via pgvector — busca sessões anteriores
 *   com estratégias bem-sucedidas (search_queries.status = 'done', artigos > 5).
 *   Requer coluna `query_embedding vector(768)` em search_queries.
 *
 * Referências:
 * - Self-RAG (Asai et al., 2023 — ICLR 2024)
 * - Adaptive RAG (Jeong et al., 2024)
 *
 * Fase B (IA-03): Use-Case RAG few-shot.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface UseCaseExample {
  /** Tópico original do usuário */
  topic: string;
  /** Domínio temático */
  domain: string;
  /** Queries booleanas geradas (exemplos de alta qualidade) */
  queries: string[];
  /** Por que esta estratégia foi eficaz */
  rationale: string;
}

// ─── Exemplos Canônicos (V1 — estáticos) ─────────────────────────────────────

const CANONICAL_EXAMPLES: UseCaseExample[] = [
  {
    domain: 'educação e tecnologia',
    topic: 'gamificação no ensino superior',
    queries: [
      '("gamificação" OR "gamification") AND ("ensino superior" OR "educação superior" OR "universidade")',
      '("gamification" OR "game-based learning") AND ("higher education" OR "university" OR "undergraduate")',
    ],
    rationale:
      'Combina o termo em PT e EN; usa "ensino superior" e "higher education" como âncoras principais.',
  },
  {
    domain: 'inteligência artificial e saúde',
    topic: 'machine learning aplicado ao diagnóstico médico',
    queries: [
      '("machine learning" OR "deep learning") AND ("medical diagnosis" OR "clinical diagnosis" OR "disease detection")',
      '("aprendizado de máquina" OR "inteligência artificial") AND ("diagnóstico médico" OR "saúde" OR "medicina")',
    ],
    rationale:
      'Tópico predominantemente internacional → prioriza inglês; inclui PT para capturar publicações nacionais.',
  },
  {
    domain: 'inclusão digital e diversidade',
    topic: 'inclusão digital para mulheres em tecnologia',
    queries: [
      '("inclusão digital" OR "letramento digital") AND (mulheres OR gênero) AND (tecnologia OR computação)',
      '("digital inclusion" OR "digital literacy") AND (women OR gender) AND (technology OR computing OR STEM)',
    ],
    rationale:
      'Conceitos de gênero devem aparecer explicitamente; "STEM" amplia cobertura em inglês.',
  },
  {
    domain: 'engenharia de software',
    topic: 'metodologias ágeis em desenvolvimento de software',
    queries: [
      '("metodologias ágeis" OR "scrum" OR "kanban" OR "extreme programming") AND ("desenvolvimento de software")',
      '("agile methodology" OR "scrum" OR "kanban") AND ("software development" OR "software engineering")',
    ],
    rationale:
      'Scrum e Kanban são bons termos de especificidade; "XP" pode ser muito ambíguo sem contexto.',
  },
  {
    domain: 'acessibilidade e web',
    topic: 'acessibilidade em interfaces web para pessoas com deficiência visual',
    queries: [
      '("acessibilidade web" OR "WCAG" OR "WAI-ARIA") AND ("deficiência visual" OR "cegueira" OR "baixa visão")',
      '("web accessibility" OR "WCAG" OR "screen reader") AND ("visual impairment" OR "blindness" OR "low vision")',
      '("interface acessível" OR "design inclusivo") AND ("tecnologia assistiva") AND web',
    ],
    rationale:
      'WCAG e WAI-ARIA são termos-chave da área; "tecnologia assistiva" amplia cobertura nacional.',
  },
  {
    domain: 'privacidade e segurança',
    topic: 'privacidade de dados em aplicações móveis',
    queries: [
      '("privacidade de dados" OR "proteção de dados" OR "LGPD") AND ("aplicações móveis" OR "apps" OR "Android" OR "iOS")',
      '("data privacy" OR "data protection" OR "GDPR") AND ("mobile applications" OR "mobile apps" OR "smartphones")',
    ],
    rationale: 'LGPD (BR) e GDPR (EU) são âncoras regulatórias importantes neste domínio.',
  },
  {
    domain: 'computação na nuvem',
    topic: 'microsserviços e escalabilidade em sistemas distribuídos',
    queries: [
      '("microservices" OR "microsserviços") AND ("scalability" OR "escalabilidade") AND ("distributed systems" OR "sistemas distribuídos")',
      '("container orchestration" OR "kubernetes" OR "docker") AND ("microservices architecture" OR "service mesh")',
    ],
    rationale:
      'Termos técnicos como kubernetes/docker são melhores em inglês; incluir PT para cobertura nacional.',
  },
  {
    domain: 'ensino de programação',
    topic: 'ensino de programação para crianças no ensino fundamental',
    queries: [
      '("ensino de programação" OR "pensamento computacional") AND ("crianças" OR "ensino fundamental" OR "educação básica")',
      '("programming education" OR "computational thinking" OR "coding") AND (children OR "primary school" OR "elementary school")',
      '("Scratch" OR "block-based programming" OR "robotics") AND (children OR "K-12" OR "primary education")',
    ],
    rationale:
      'Scratch é relevante aqui; "K-12" captura literatura norte-americana sobre ensino fundamental/médio.',
  },
];

// ─── Similaridade lexical simples (sem embedding) ─────────────────────────────

/**
 * Calcula similaridade léxica entre dois textos usando bigramas de palavras.
 * Suficientemente precisa para recuperar exemplos canônicos relevantes.
 * @returns Score 0-1 (1 = idêntico)
 */
function lexicalSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  // Jaccard similarity
  return intersection / (tokensA.size + tokensB.size - intersection);
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Recupera os N exemplos mais similares ao tópico fornecido.
 * V1: Similaridade léxica (Jaccard sobre tokens).
 * V2 (futuro): Substituir por cosine similarity sobre embeddings pgvector.
 *
 * @param topic    Tópico de pesquisa
 * @param topN     Número de exemplos a retornar
 * @returns        Exemplos formatados para injeção como few-shot context
 */
export function retrieveUseCaseExamples(topic: string, topN = 2): string {
  // Calcula similaridade com cada exemplo canônico
  const scored = CANONICAL_EXAMPLES.map((ex) => ({
    example: ex,
    score: lexicalSimilarity(topic, `${ex.topic} ${ex.domain}`),
  })).sort((a, b) => b.score - a.score);

  // Fase C (IA-04): threshold 0.05→0.15 — evita injetar exemplos irrelevantes como
  // few-shot context no StrategyAgent (ex: "blockchain" para "ensino de crianças").
  const top = scored.slice(0, topN).filter((s) => s.score > 0.15);

  if (top.length === 0) return '';

  const formatted = top
    .map(
      (s, i) =>
        `EXEMPLO ${i + 1} (domínio: ${s.example.domain}, similaridade: ${(s.score * 100).toFixed(0)}%):\n` +
        `Tópico: "${s.example.topic}"\n` +
        `Queries geradas:\n${s.example.queries.map((q, j) => `  ${j + 1}. ${q}`).join('\n')}\n` +
        `Rationale: ${s.example.rationale}`
    )
    .join('\n\n');

  return `\n\n## EXEMPLOS DE ESTRATÉGIAS SIMILARES (use como referência de qualidade):\n${formatted}`;
}

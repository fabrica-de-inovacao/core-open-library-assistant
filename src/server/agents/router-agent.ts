/**
 * @file router-agent.ts
 * @description Agente de roteamento de intenção — classifica o input do usuário
 * em uma de três rotas ANTES de qualquer tool call:
 *
 *   - 'conversational'    → pergunta geral / factual / definição simples →  resposta direta, sem busca
 *   - 'quick_lookup'      → quer referências/artigos sobre um tema de forma pontual → busca + síntese BRIEF
 *   - 'systematic_review' → quer revisão bibliográfica, mapeamento ou análise densa → pipeline completo
 *
 * Arquitetura de 2 camadas:
 *   Camada 1 — Regras lexicais (0ms, determinístico, cobre ~70% dos casos)
 *   Camada 2 — LLM leve (gemini-1.5-flash, ~150ms, para casos ambíguos)
 *
 * Referência: Adaptive RAG (Jeong et al., 2024), Semantic Router (Austin et al., 2024)
 */

import { generateText } from 'ai';
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import { logger } from '@/lib/logger';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type RouteIntent = 'conversational' | 'quick_lookup' | 'systematic_review';
export type RouteConfidence = 'rule' | 'model' | 'user_override';

export interface RouteResult {
  intent: RouteIntent;
  confidence: RouteConfidence;
  /** Qual regra ou raciocínio do modelo levou à decisão */
  reasoning: string;
  /** Profundidade de síntese recomendada para o SynthesisAgent */
  synthesisDepth: SynthesisDepth;
}

/** Mapeamento de intent → profundidade padrão de síntese */
export type SynthesisDepth = 'brief' | 'standard' | 'full';

const DEPTH_FOR_INTENT: Record<RouteIntent, SynthesisDepth> = {
  conversational: 'brief',
  quick_lookup: 'standard',
  systematic_review: 'full',
};

// ─── Camada 1: Regras lexicais ───────────────────────────────────────────────

// Marcadores que sinalizam revisão sistemática com alta confiança
const SYSTEMATIC_MARKERS = [
  'revisão sistemática',
  'revisao sistematica',
  'systematic review',
  'literature review',
  'scoping review',
  'mapeamento sistemático',
  'mapeamento da literatura',
  'estado da arte',
  'estado-da-arte',
  'quais estudos',
  'quais pesquisas',
  'quais artigos',
  'papers sobre',
  'artigos sobre',
  'publicações sobre',
  'me dê artigos',
  'me da artigos',
  'me mostra artigos',
  'pesquise sobre',
  'busque sobre',
  'busca sobre',
  'encontre artigos',
  'encontre papers',
  'encontre publicações',
  'bibliografi',
  'referências sobre',
  'referencias sobre',
  'literatura sobre',
  'literatura acerca',
  'mostre artigos',
  'mostre papers',
  'levantamento bibliográfico',
  'levantamento de literatura',
];

// Marcadores que sinalizam consulta pontual / lookup rápido
const QUICK_LOOKUP_MARKERS = [
  'alguns artigos',
  'algum paper',
  'um artigo',
  'um paper',
  'referências rápidas',
  'me indica',
  'indicação de',
  'me sugere',
  'sugestão de leitura',
  'sugestões de leitura',
  'quero ler sobre',
  'leitura sobre',
];

// Marcadores que sinalizam conversa pura (sem busca)
const CONVERSATIONAL_MARKERS = [
  'oi',
  'olá',
  'ola',
  'bom dia',
  'boa tarde',
  'boa noite',
  'hey',
  'hi ',
  'hello',
  'obrigado',
  'obrigada',
  'valeu',
  'thanks',
  'tudo bem',
  'como você',
  'como vc',
];

// Padrões que sozinhos indicam conversa (via regex)
const DEFINITIONAL_PATTERNS = [
  /^o\s+qu[eê]\s+(é|e)\s+/i, // "o que é X"
  /^qu[aã]l\s+a\s+diferen[çc]a\s+/i, // "qual a diferença entre X e Y"
  /^explique\s+/i, // "explique X"
  /^me\s+(explique|fale|diga|conta)\s+/i, // "me explique / me diga"
  /^como\s+funciona\s+/i, // "como funciona X"
  /^defin[aei]\s+/i, // "define / defina X"
  /^o\s+que\s+significa\s+/i, // "o que significa X"
];

/**
 * Detecta perguntas de opinião/retóricas PURAS curtas (≤ 6 palavras, terminam em ?).
 * Critério: verbo de ligação (é/são) + adjetivo de julgamento, ou estruturas retóricas pronominais.
 * Ex capturados: "React é bom?", "isso é correto?", "IA é perigosa?", "isso funciona?"
 * Ex NÃO capturados (intencionalmente): "IA gasta água?", "LLMs consomem energia?" — são
 * perguntas EMPÍRICAS com potencial acadêmico → rota quick_lookup → busca SOL → chips OpenAlex.
 * Fase C (IA-04): fix RouterAgent para opiniões puras.
 */
const OPINION_QUESTION_PATTERNS = [
  // Verbo de estado/opinião no início: "é X?", "isso é X?"
  /^(isso|aquilo|ele|ela|eles)?\s*(é|sao|são|foi|era|será|pode|vai|deve)\s+/i,
  // "IA é X?", "React é bom?"
  /^[\w\s]{1,30}\s+(é|são|foi|era|será|bom|ruim|melhor|pior|certo|errado|util|inútil)\b.*\?$/i,
  // "isso funciona?", "isso vale?", "realmente funciona?"
  /^(isso|isto|aqui|realmente|ainda|já|mesmo)?\s*(funciona|vale|serve|existe|acontece|faz sentido)\b.*\?$/i,
];

/** Keywords que indicam intenção bibliográfica (impedem rota conversational) */
const BIBLIOGRAPHIC_INTENT_WORDS = [
  'artigo',
  'artigos',
  'paper',
  'papers',
  'publicação',
  'publicações',
  'pesquisa',
  'estudos',
  'literatura',
  'referência',
  'referências',
  'busca',
  'buscar',
  'encontrar',
  'revisar',
  'revisão',
];

/**
 * Retorna true se o input for uma pergunta de opinião/retórica curta
 * sem intenção bibliográfica explícita.
 */
function isShortOpinionQuestion(input: string, wordCount: number): boolean {
  if (wordCount > 6) return false; // Só aplica em inputs curtos
  const trimmed = input.trim();
  if (!trimmed.endsWith('?')) return false; // Deve terminar com ?
  const lower = trimmed.toLowerCase();
  // Se contém intenção bibliográfica, não é opinião pura
  if (BIBLIOGRAPHIC_INTENT_WORDS.some((w) => lower.includes(w))) return false;
  // Deve bater em um padrão de opinião
  return OPINION_QUESTION_PATTERNS.some((p) => p.test(lower));
}

function lexicalRoute(input: string): RouteResult | null {
  const normalized = input.toLowerCase().trim();

  // Check conversational first (mais restritivo)
  if (CONVERSATIONAL_MARKERS.some((m) => normalized === m || normalized.startsWith(m + ' '))) {
    return {
      intent: 'conversational',
      confidence: 'rule',
      reasoning: `Matched conversational marker`,
      synthesisDepth: 'brief',
    };
  }
  for (const pattern of DEFINITIONAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        intent: 'conversational',
        confidence: 'rule',
        reasoning: `Matched definitional pattern: ${pattern.source}`,
        synthesisDepth: 'brief',
      };
    }
  }

  // Check systematic review (alta confiança)
  if (SYSTEMATIC_MARKERS.some((m) => normalized.includes(m))) {
    return {
      intent: 'systematic_review',
      confidence: 'rule',
      reasoning: `Matched systematic marker`,
      synthesisDepth: 'full',
    };
  }

  // Check quick lookup
  if (QUICK_LOOKUP_MARKERS.some((m) => normalized.includes(m))) {
    return {
      intent: 'quick_lookup',
      confidence: 'rule',
      reasoning: `Matched quick-lookup marker`,
      synthesisDepth: 'standard',
    };
  }

  return null; // indeciso → camada 2 (LLM)
}

// ─── Camada 2: LLM leve ─────────────────────────────────────────────────────

async function llmRoute(input: string): Promise<RouteResult> {
  try {
    const { text } = await generateText({
      model: getModelForTask('reranker'), // modelo leve (gemini-1.5-flash)
      system: `Você é um classificador de intenção para uma plataforma de pesquisa acadêmica.
Sua tarefa: dado o input do usuário, classificar a intenção em UMA das três categorias abaixo.

CATEGORIAS:
- "conversational": pergunta geral / factual / definição simples (o que é X, como funciona Y, explique Z). Não quer busca bibliográfica.
- "quick_lookup": quer encontrar alguns artigos ou referências sobre um tema de forma pontual, sem precisar de análise densa.
- "systematic_review": quer uma revisão bibliográfica, mapeamento da literatura, estado da arte, análise sistemática com múltiplos artigos.

Retorne APENAS um JSON com dois campos: "intent" (uma das três palavras exatas acima) e "reasoning" (1 frase curta).
Exemplo: {"intent":"systematic_review","reasoning":"Usuário quer mapear a literatura sobre gamificação"}`,
      prompt: `Input do usuário: "${input.slice(0, 500)}"`,
    });

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { intent?: string; reasoning?: string };
      const intent = (
        ['conversational', 'quick_lookup', 'systematic_review'].includes(parsed.intent ?? '')
          ? parsed.intent
          : 'quick_lookup'
      ) as RouteIntent;
      return {
        intent,
        confidence: 'model',
        reasoning: parsed.reasoning ?? 'LLM classification',
        synthesisDepth: DEPTH_FOR_INTENT[intent],
      };
    }
  } catch (err) {
    logger.warn(
      `[RouterAgent] ⚠️ LLM classification failed — defaulting to quick_lookup | model=${getModelIdForTask('reranker')}`,
      err
    );
  }

  // Fallback conservador: se o LLM falhar, assume quick_lookup
  return {
    intent: 'quick_lookup',
    confidence: 'model',
    reasoning: 'Fallback (LLM error)',
    synthesisDepth: 'standard',
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Classifica a intenção do input do usuário em uma rota.
 * Camada 1 (lexical, 0ms) → Camada 2 (LLM, ~150ms) quando indeciso.
 *
 * @param input          Última mensagem do usuário
 * @param userOverride   Modo explicitamente escolhido pelo usuário na UI ('quick'|'systematic')
 */
export async function runRouterAgent(
  input: string,
  userOverride?: 'quick' | 'systematic' | null
): Promise<RouteResult> {
  // User override → camada 0 (determinístico)
  if (userOverride === 'quick') {
    return {
      intent: 'quick_lookup',
      confidence: 'user_override',
      reasoning: 'User chose quick mode',
      synthesisDepth: 'standard',
    };
  }
  if (userOverride === 'systematic') {
    return {
      intent: 'systematic_review',
      confidence: 'user_override',
      reasoning: 'User chose systematic mode',
      synthesisDepth: 'full',
    };
  }

  // Inputs muito curtos (≤ 6 palavras) → tendência conversacional exceto se contiver marcadores
  const wordCount = input.trim().split(/\s+/).length;

  // Camada 1: lexical
  const lexResult = lexicalRoute(input);
  if (lexResult) {
    logger.debug(
      `[RouterAgent] intent=${lexResult.intent} | confidence=rule | words=${wordCount}`
    );
    return lexResult;
  }

  // Fase C (IA-04): perguntas de opinião/retóricas curtas → conversational
  // Ex: "IA gasta agua?", "React é bom?", "isso funciona?"
  if (isShortOpinionQuestion(input, wordCount)) {
    const result: RouteResult = {
      intent: 'conversational',
      confidence: 'rule',
      reasoning: `Short opinion/rhetorical question (${wordCount} words, ends with ?) — routing to conversational`,
      synthesisDepth: 'brief',
    };
    logger.debug(
      `[RouterAgent] intent=${result.intent} | confidence=rule (opinion) | words=${wordCount}`
    );
    return result;
  }

  // Ambíguo: inputs muito curtos (≤3 palavras) sem marcadores são provavelmente quick_lookup
  if (wordCount <= 3) {
    const result: RouteResult = {
      intent: 'quick_lookup',
      confidence: 'rule',
      reasoning: `Short input (${wordCount} words, ≤3) — defaulting to quick_lookup`,
      synthesisDepth: 'standard',
    };
    logger.debug(
      `[RouterAgent] intent=${result.intent} | confidence=rule (short) | words=${wordCount}`
    );
    return result;
  }

  // Camada 2: LLM
  const llmResult = await llmRoute(input);
  logger.debug(`[RouterAgent] intent=${llmResult.intent} | confidence=model | words=${wordCount}`);
  return llmResult;
}

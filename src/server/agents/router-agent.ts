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
    console.warn(
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
    console.log(
      `[RouterAgent] ✅ intent=${lexResult.intent} | confidence=rule | words=${wordCount}`
    );
    return lexResult;
  }

  // Ambíguo: inputs curtos sem marcadores são provavelmente quick_lookup
  if (wordCount <= 5) {
    const result: RouteResult = {
      intent: 'quick_lookup',
      confidence: 'rule',
      reasoning: `Short input (${wordCount} words) — defaulting to quick_lookup`,
      synthesisDepth: 'standard',
    };
    console.log(
      `[RouterAgent] ✅ intent=${result.intent} | confidence=rule (short) | words=${wordCount}`
    );
    return result;
  }

  // Camada 2: LLM
  const llmResult = await llmRoute(input);
  console.log(
    `[RouterAgent] ✅ intent=${llmResult.intent} | confidence=model | words=${wordCount} | reasoning="${llmResult.reasoning}"`
  );
  return llmResult;
}

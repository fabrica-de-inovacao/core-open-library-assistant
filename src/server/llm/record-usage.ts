import { db } from '@/server/db';
import { llmUsageEvents } from '@/server/db/schema';
import { MODEL_CATALOG } from '@/lib/llm/registry';

interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

/** Procura a definição do modelo no catálogo por id. */
function findModelDef(model: string) {
  return (Object.values(MODEL_CATALOG) as { id: string; inputPricePerM: number; outputPricePerM: number; provider: string }[][])
    .flat()
    .find((m) => m.id === model);
}

/**
 * Estima custo em micro-USD (1/1.000.000 USD) com base no catálogo de modelos.
 * Cached input é tipicamente cobrado a ~25% do input normal.
 */
export function estimateCostMicrousd(model: string, usage: UsageShape): number {
  const def = findModelDef(model);
  if (!def) return 0;

  const inputTokens = Math.max(0, (usage.inputTokens ?? 0) - (usage.cachedInputTokens ?? 0));
  const cachedTokens = usage.cachedInputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  // pricePerM (USD/1M tokens) = µUSD/token diretamente.
  // 1M tokens × $2/M = $2 = 2_000_000 µUSD → 2 µUSD/token.
  const cost =
    inputTokens * def.inputPricePerM +
    cachedTokens * def.inputPricePerM * 0.25 +
    outputTokens * def.outputPricePerM;

  return Math.round(cost);
}

/** Deriva o provider a partir do model id, com fallback. */
export function providerForModel(model: string): string {
  return findModelDef(model)?.provider ?? 'google';
}

/**
 * Grava um evento de uso na tabela llm_usage_events.
 * Não bloqueia — falha silenciosamente se o banco estiver indisponível.
 */
export async function recordUsage(params: {
  userId: string | null;
  requestId?: string | null;
  provider?: string;
  model: string;
  task: string;
  usage: UsageShape;
  credentialMode?: 'server_key' | 'own_key';
}): Promise<void> {
  try {
    await db.insert(llmUsageEvents).values({
      userId: params.userId ?? null,
      requestId: params.requestId ?? null,
      provider: params.provider ?? providerForModel(params.model),
      model: params.model,
      task: params.task,
      credentialMode: params.credentialMode ?? 'server_key',
      inputTokens: params.usage.inputTokens ?? 0,
      cachedInputTokens: params.usage.cachedInputTokens ?? 0,
      outputTokens: params.usage.outputTokens ?? 0,
      estimatedCostMicrousd: estimateCostMicrousd(params.model, params.usage),
    });
  } catch (err) {
    // Não propagar: gravação de métricas nunca deve quebrar o fluxo principal.
    console.warn('[usage] falha ao gravar llm_usage_events:', (err as Error).message);
  }
}


import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { userLlmSettings } from '@/server/db/schema';
import { decryptSecret } from './crypto';
import { isLlmProvider, PROVIDERS, type LlmProvider } from '@/lib/llm/registry';
import type { LlmRuntimeConfig } from '@/lib/llm/adapters';

export async function resolveLlmConfig(userId: string | null): Promise<LlmRuntimeConfig> {
  const fallbackProvider = process.env.LLM_PROVIDER?.toLowerCase();
  let provider: LlmProvider = isLlmProvider(fallbackProvider) ? fallbackProvider : 'google';
  let models: Record<string, string> = {};
  let apiKey = process.env[PROVIDERS[provider].envKey];

  if (userId) {
    const [settings] = await db
      .select()
      .from(userLlmSettings)
      .where(eq(userLlmSettings.userId, userId))
      .limit(1);

    if (settings && isLlmProvider(settings.provider)) {
      provider = settings.provider;
      models = settings.models ?? {};
      apiKey = process.env[PROVIDERS[provider].envKey];
      if (settings.useOwnKey && settings.encryptedApiKey) {
        apiKey = decryptSecret(settings.encryptedApiKey);
      }
    }
  }

  return { provider, apiKey, models };
}

export function resolveEmbeddingConfig(): LlmRuntimeConfig {
  const rawProvider = process.env.EMBEDDING_PROVIDER?.toLowerCase();
  const fallbackProvider = process.env.LLM_PROVIDER?.toLowerCase();
  let provider: LlmProvider = isLlmProvider(rawProvider)
    ? rawProvider
    : isLlmProvider(fallbackProvider) && fallbackProvider !== 'groq'
      ? fallbackProvider
      : 'google';

  if (provider === 'groq') provider = 'google';

  return {
    provider,
    apiKey: process.env[PROVIDERS[provider].envKey],
    models: {
      embedding: process.env.EMBEDDING_MODEL,
    },
  };
}

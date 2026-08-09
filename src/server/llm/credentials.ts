import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { userLlmSettings, userProviderCredentials } from '@/server/db/schema';
import { decryptSecret } from './crypto';
import { isLlmPreset, isLlmProvider, presetModels, PROVIDERS, validateModels, type LlmProvider } from '@/lib/llm/registry';
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
      const preset = isLlmPreset(settings.preset) ? settings.preset : 'balanced';
      const overrides = settings.models ?? {};
      models = { ...presetModels(provider, preset), ...(validateModels(provider, overrides) ? overrides : {}) };
      apiKey = process.env[PROVIDERS[provider].envKey];
      if (settings.useOwnKey) {
        const [credential] = await db
          .select()
          .from(userProviderCredentials)
          .where(eq(userProviderCredentials.userId, userId))
          .limit(1);
        if (credential?.provider === provider) apiKey = decryptSecret(credential.encryptedApiKey);
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

export async function resolveUserEmbeddingConfig(userId: string | null): Promise<LlmRuntimeConfig> {
  const generation = await resolveLlmConfig(userId);
  const provider: LlmProvider = generation.provider === 'groq' ? 'openai' : generation.provider;
  let apiKey = process.env[PROVIDERS[provider].envKey];

  if (userId) {
    const [settings] = await db.select().from(userLlmSettings).where(eq(userLlmSettings.userId, userId)).limit(1);
    if (settings?.useOwnKey) {
      const credentials = await db.select().from(userProviderCredentials).where(eq(userProviderCredentials.userId, userId));
      const credential = credentials.find((item) => item.provider === provider);
      if (credential) apiKey = decryptSecret(credential.encryptedApiKey);
    }
  }

  return {
    provider,
    apiKey,
    models: { embedding: provider === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-001' },
  };
}

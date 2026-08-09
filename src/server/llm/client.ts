import { createEmbedding, createLanguageModel } from '@/lib/llm/adapters';
import type { LlmTask } from '@/lib/llm/registry';
import { resolveUserEmbeddingConfig, resolveLlmConfig } from './credentials';

export async function getUserModel(userId: string | null, task: Exclude<LlmTask, 'embedding'>) {
  return createLanguageModel(await resolveLlmConfig(userId), task);
}

export async function getUserEmbeddingModel(userId: string | null) {
  return createEmbedding(await resolveUserEmbeddingConfig(userId));
}

import { createEmbedding, createLanguageModel } from '@/lib/llm/adapters';
import type { LlmTask } from '@/lib/llm/registry';
import { resolveEmbeddingConfig, resolveLlmConfig } from './credentials';

export async function getUserModel(userId: string | null, task: Exclude<LlmTask, 'embedding'>) {
  return createLanguageModel(await resolveLlmConfig(userId), task);
}

export async function getUserEmbeddingModel(userId: string | null) {
  void userId;
  return createEmbedding(resolveEmbeddingConfig());
}

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { defaultModel, type LlmProvider, type LlmTask } from './registry';

export type LlmRuntimeConfig = {
  provider: LlmProvider;
  apiKey?: string;
  models?: Partial<Record<LlmTask, string>>;
};

export function resolveModelId(config: LlmRuntimeConfig, task: LlmTask) {
  return config.models?.[task] || defaultModel(config.provider, task);
}

export function createLanguageModel(config: LlmRuntimeConfig, task: Exclude<LlmTask, 'embedding'>): LanguageModel {
  const modelId = resolveModelId(config, task);
  if (config.provider === 'google') return createGoogleGenerativeAI({ apiKey: config.apiKey })(modelId);
  if (config.provider === 'openai') return createOpenAI({ apiKey: config.apiKey }).chat(modelId);
  if (config.provider === 'groq') return createGroq({ apiKey: config.apiKey })(modelId);
  throw new Error(`Provider não suportado: ${config.provider}`);
}

export function createEmbedding(config: LlmRuntimeConfig): EmbeddingModel {
  const provider = config.provider === 'groq' ? 'google' : config.provider;
  const modelId = config.models?.embedding || defaultModel(provider, 'embedding');
  if (provider === 'google') return createGoogleGenerativeAI({ apiKey: config.apiKey }).embedding(modelId) as EmbeddingModel;
  return createOpenAI({ apiKey: config.apiKey }).embedding(modelId) as EmbeddingModel;
}

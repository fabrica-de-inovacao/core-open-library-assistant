import type { EmbeddingModel, LanguageModel } from 'ai';
import { createEmbedding, createLanguageModel, type LlmRuntimeConfig } from '@/lib/llm/adapters';
import { defaultModel, isLlmProvider, type LlmProvider } from '@/lib/llm/registry';

export const EMBEDDING_DIMENSIONS = 768;

export type AgentTask = 'orchestrator' | 'synthesis' | 'reranker' | 'tldr' | 'strategy';

const TASK_ENV: Record<AgentTask, string> = {
  orchestrator: 'LLM_MODEL_ORCHESTRATOR',
  synthesis: 'LLM_MODEL_SYNTHESIS',
  reranker: 'LLM_MODEL_RERANKER',
  tldr: 'LLM_MODEL_TLDR',
  strategy: 'LLM_MODEL_STRATEGY',
};

function envProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER?.toLowerCase();
  return isLlmProvider(provider) ? provider : 'google';
}

function envConfig(): LlmRuntimeConfig {
  const provider = envProvider();
  return {
    provider,
    models: {
      orchestrator: process.env.LLM_MODEL_ORCHESTRATOR || process.env.LLM_MODEL || defaultModel(provider, 'orchestrator'),
      synthesis: process.env.LLM_MODEL_SYNTHESIS || process.env.LLM_MODEL || defaultModel(provider, 'synthesis'),
      reranker: process.env.LLM_MODEL_RERANKER || process.env.LLM_MODEL || defaultModel(provider, 'reranker'),
      tldr: process.env.LLM_MODEL_TLDR || process.env.LLM_MODEL || defaultModel(provider, 'tldr'),
      strategy: process.env.LLM_MODEL_STRATEGY || process.env.LLM_MODEL || defaultModel(provider, 'strategy'),
      embedding: process.env.EMBEDDING_MODEL || defaultModel(provider === 'groq' ? 'openai' : provider, 'embedding'),
    },
  };
}

export function getModelForTask(task: AgentTask): LanguageModel {
  return createLanguageModel(envConfig(), task);
}

export function getModelById(modelId: string): LanguageModel {
  return createLanguageModel({ ...envConfig(), models: { orchestrator: modelId } }, 'orchestrator');
}

export function getModelIdForTask(task: AgentTask): string {
  return process.env[TASK_ENV[task]] || process.env.LLM_MODEL || defaultModel(envProvider(), task);
}

export function getEmbeddingModel(): EmbeddingModel {
  const config = envConfig();
  if (config.provider === 'groq') {
    return createEmbedding({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      models: { embedding: 'text-embedding-3-small' },
    });
  }
  return createEmbedding(config);
}

export function getEmbeddingModelId(): string {
  const provider = envProvider();
  return process.env.EMBEDDING_MODEL || defaultModel(provider === 'groq' ? 'google' : provider, 'embedding');
}

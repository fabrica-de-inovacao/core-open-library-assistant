/**
 * @file ai-provider.ts
 * @description Plug-and-play LLM provider adapter, compatível com ai@4.x.
 *
 * Configure via .env:
 *   LLM_PROVIDER        = "google" | "openai"
 *   LLM_MODEL           = modelo global (fallback para todas as tasks)
 *   LLM_MODEL_TLDR      = modelo específico para geração de TL;DRs em batch (Inngest)
 *   LLM_MODEL_SYNTHESIS = modelo específico para síntese da revisão sistemática
 *   LLM_MODEL_RERANKER  = modelo específico para reranking semântico
 *
 * Versões: ai@6.0.105, @ai-sdk/google@3.0.34, @ai-sdk/openai@3.0.37, @ai-sdk/react@3.0.107
 * Compatibilidade: todos usam @ai-sdk/provider@3.0.8 + @ai-sdk/provider-utils@4.0.16 (sem conflitos nested).
 */

import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';

// P-03: @ai-sdk/google usa v1beta por padrão, mas text-embedding-004 exige a API v1 estável.
// Instância separada só para embeddings — não afeta os modelos de linguagem.
const googleEmbedding = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1',
});

/** Dimensões do modelo de embedding padrão (text-embedding-004 = 768). */
export const EMBEDDING_DIMENSIONS = 768;

type SupportedProvider = 'google' | 'openai';

/**
 * Tarefas de agente suportadas.
 * Cada task pode usar um modelo diferente para balancear custo vs. qualidade.
 *
 * - orchestrator: chat principal, multi-step, tool calling
 * - synthesis:    geração da revisão sistemática (texto longo, alta qualidade)
 * - reranker:     avaliação de relevância semântica (curto, rápido)
 * - tldr:         geração de TL;DRs em batch no Inngest (barato, volume alto)
 * - strategy:     planejamento de queries de busca (quality over cost)
 */
export type AgentTask = 'orchestrator' | 'synthesis' | 'reranker' | 'tldr' | 'strategy';

/**
 * Mapeamento de modelos por provider e task.
 * Lógica: tasks de alto volume (tldr, reranker) usam modelos leves;
 *         tasks de alta qualidade (orchestrator, synthesis) usam modelos premium.
 */
const TASK_MODELS: Record<SupportedProvider, Record<AgentTask, string>> = {
  google: {
    orchestrator: 'gemini-2.5-flash',
    synthesis: 'gemini-2.5-flash',
    strategy: 'gemini-2.5-flash',
    reranker: 'gemini-1.5-flash',
    tldr: 'gemini-1.5-flash', // volume alto, custo menor
  },
  openai: {
    orchestrator: 'gpt-4o',
    synthesis: 'gpt-4o',
    strategy: 'gpt-4o',
    reranker: 'gpt-4o-mini',
    tldr: 'gpt-4o-mini',
  },
};

/**
 * Retorna um LanguageModel para uma task específica.
 * Hierarquia de override (envs):
 *   LLM_MODEL_{TASK} > LLM_MODEL > TASK_MODELS[provider][task]
 *
 * @example
 * // Inngest TL;DR step — modelo leve
 * const { text } = await generateText({ model: getModelForTask('tldr'), ... });
 *
 * // Chat route — modelo premium
 * const result = await streamText({ model: getModelForTask('orchestrator'), ... });
 */
export function getModelForTask(task: AgentTask): LanguageModel {
  const provider = (process.env.LLM_PROVIDER ?? 'google').toLowerCase() as SupportedProvider;

  // Permite override por task: LLM_MODEL_TLDR, LLM_MODEL_SYNTHESIS, etc.
  const envKey = `LLM_MODEL_${task.toUpperCase()}` as keyof NodeJS.ProcessEnv;
  const modelId =
    (process.env[envKey] as string | undefined) ??
    process.env.LLM_MODEL ??
    TASK_MODELS[provider]?.[task] ??
    TASK_MODELS[provider].orchestrator;

  switch (provider) {
    case 'openai':
      return openai(modelId) as unknown as LanguageModel;
    case 'google':
    default:
      return google(modelId) as unknown as LanguageModel;
  }
}

/**
 * Alias backward-compatible — equivalente a getModelForTask('orchestrator').
 * Mantido para não quebrar chamadas existentes.
 */
export function getLanguageModel(): LanguageModel {
  return getModelForTask('orchestrator');
}

/**
 * Retorna um EmbeddingModel compatível com ai@3.4.15 para o provider configurado.
 * Usado pelo Inngest para computar embeddings de abstracts.
 *
 * Modelos:
 *   Google → text-embedding-004  (768 dims, multilingual)
 *   OpenAI → text-embedding-3-small  (1536 dims)
 *
 * Override via env: EMBEDDING_MODEL (ex: "text-embedding-004")
 */
export function getEmbeddingModel(): EmbeddingModel {
  const provider = (process.env.LLM_PROVIDER ?? 'google').toLowerCase() as SupportedProvider;
  const modelId =
    process.env.EMBEDDING_MODEL ??
    (provider === 'openai' ? 'text-embedding-3-small' : 'text-embedding-004');

  switch (provider) {
    case 'openai':
      return openai.embedding(modelId) as unknown as EmbeddingModel;
    case 'google':
    default:
      // P-03: usa instância com baseURL v1 para garantir compatibilidade com text-embedding-004
      return googleEmbedding.textEmbeddingModel(modelId) as unknown as EmbeddingModel;
  }
}

/** O nome do modelo resolvido para uma task — útil para logging. */
export function getModelIdForTask(task: AgentTask): string {
  const provider = (process.env.LLM_PROVIDER ?? 'google').toLowerCase() as SupportedProvider;
  const envKey = `LLM_MODEL_${task.toUpperCase()}` as keyof NodeJS.ProcessEnv;
  return (
    (process.env[envKey] as string | undefined) ??
    process.env.LLM_MODEL ??
    TASK_MODELS[provider]?.[task] ??
    TASK_MODELS[provider].orchestrator
  );
}

/** @deprecated Use getModelIdForTask('orchestrator') */
export function getLanguageModelId(): string {
  return getModelIdForTask('orchestrator');
}

/**
 * @file ai-provider.ts
 * @description Plug-and-play LLM provider adapter, compatible with ai@3.4.15.
 *
 * Configure via .env:
 *   LLM_PROVIDER = "google" | "openai"
 *   LLM_MODEL    = e.g. "gemini-1.5-flash" | "gpt-4o-mini"
 *
 * Uses @ai-sdk/google@0.0.x and @ai-sdk/openai@3.x (both compatible with ai@3.4.15).
 * The @ai-sdk/google@3.x provider was incompatible — keep this package pinned to 0.0.55.
 */

import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

type SupportedProvider = 'google' | 'openai';

/** Default models per provider */
const DEFAULT_MODELS: Record<SupportedProvider, string> = {
  google: 'gemini-1.5-flash',
  openai: 'gpt-4o-mini',
};

/**
 * Returns a ai@3.4.15-compatible LanguageModel from the env-configured provider.
 *
 * @example
 * // .env:  LLM_PROVIDER=google  LLM_MODEL=gemini-1.5-flash
 * import { getLanguageModel } from '@/lib/ai-provider';
 * const result = await streamText({ model: getLanguageModel(), ... });
 */
export function getLanguageModel(): LanguageModel {
  const provider = (process.env.LLM_PROVIDER ?? 'google').toLowerCase() as SupportedProvider;
  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case 'openai':
      return openai(modelId) as unknown as LanguageModel;
    case 'google':
    default:
      return google(modelId) as unknown as LanguageModel;
  }
}

/** The resolved model name — useful for logging. */
export function getLanguageModelId(): string {
  const provider = (process.env.LLM_PROVIDER ?? 'google').toLowerCase() as SupportedProvider;
  return process.env.LLM_MODEL ?? DEFAULT_MODELS[provider];
}

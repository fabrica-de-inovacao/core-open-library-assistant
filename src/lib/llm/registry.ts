export type LlmProvider = 'google' | 'openai' | 'groq';
export type LlmTask = 'orchestrator' | 'synthesis' | 'reranker' | 'tldr' | 'strategy' | 'embedding';
export type LlmPreset = 'economy' | 'balanced' | 'quality';

export type ModelDefinition = {
  id: string;
  label: string;
  provider: LlmProvider;
  tier: LlmPreset;
  inputPricePerM: number;
  outputPricePerM: number;
  contextWindow: number;
  stable: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  allowedTasks: LlmTask[];
};

const GENERATION_TASKS: LlmTask[] = ['orchestrator', 'synthesis', 'reranker', 'tldr', 'strategy'];

export const MODEL_CATALOG: Record<LlmProvider, ModelDefinition[]> = {
  openai: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai', tier: 'economy', inputPricePerM: 0.2, outputPricePerM: 1.2, contextWindow: 1_050_000, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai', tier: 'balanced', inputPricePerM: 2, outputPricePerM: 12, contextWindow: 1_050_000, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai', tier: 'quality', inputPricePerM: 5, outputPricePerM: 30, contextWindow: 1_050_000, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'text-embedding-3-small', label: 'Text Embedding 3 Small', provider: 'openai', tier: 'economy', inputPricePerM: 0.02, outputPricePerM: 0, contextWindow: 8_191, stable: true, supportsTools: false, supportsStructuredOutput: false, allowedTasks: ['embedding'] },
  ],
  google: [
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'google', tier: 'economy', inputPricePerM: 0.1, outputPricePerM: 0.4, contextWindow: 1_048_576, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'google', tier: 'economy', inputPricePerM: 0.3, outputPricePerM: 2.5, contextWindow: 1_048_576, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'google', tier: 'balanced', inputPricePerM: 1.5, outputPricePerM: 7.5, contextWindow: 1_048_576, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', tier: 'quality', inputPricePerM: 1.25, outputPricePerM: 10, contextWindow: 1_048_576, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'gemini-embedding-001', label: 'Gemini Embedding', provider: 'google', tier: 'economy', inputPricePerM: 0.15, outputPricePerM: 0, contextWindow: 2_048, stable: true, supportsTools: false, supportsStructuredOutput: false, allowedTasks: ['embedding'] },
  ],
  groq: [
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', provider: 'groq', tier: 'economy', inputPricePerM: 0.05, outputPricePerM: 0.08, contextWindow: 131_072, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B', provider: 'groq', tier: 'economy', inputPricePerM: 0.075, outputPricePerM: 0.3, contextWindow: 131_072, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B', provider: 'groq', tier: 'balanced', inputPricePerM: 0.15, outputPricePerM: 0.6, contextWindow: 131_072, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'groq', tier: 'quality', inputPricePerM: 0.59, outputPricePerM: 0.79, contextWindow: 131_072, stable: true, supportsTools: true, supportsStructuredOutput: true, allowedTasks: GENERATION_TASKS },
  ],
};

const PRESETS: Record<LlmProvider, Record<LlmPreset, Record<LlmTask, string>>> = {
  openai: {
    economy: { orchestrator: 'gpt-5.6-luna', synthesis: 'gpt-5.6-luna', reranker: 'gpt-5.6-luna', tldr: 'gpt-5.6-luna', strategy: 'gpt-5.6-luna', embedding: 'text-embedding-3-small' },
    balanced: { orchestrator: 'gpt-5.6-terra', synthesis: 'gpt-5.6-terra', reranker: 'gpt-5.6-luna', tldr: 'gpt-5.6-luna', strategy: 'gpt-5.6-terra', embedding: 'text-embedding-3-small' },
    quality: { orchestrator: 'gpt-5.6-sol', synthesis: 'gpt-5.6-sol', reranker: 'gpt-5.6-terra', tldr: 'gpt-5.6-luna', strategy: 'gpt-5.6-terra', embedding: 'text-embedding-3-small' },
  },
  google: {
    economy: { orchestrator: 'gemini-2.5-flash-lite', synthesis: 'gemini-2.5-flash-lite', reranker: 'gemini-2.5-flash-lite', tldr: 'gemini-2.5-flash-lite', strategy: 'gemini-2.5-flash-lite', embedding: 'gemini-embedding-001' },
    balanced: { orchestrator: 'gemini-3.6-flash', synthesis: 'gemini-3.6-flash', reranker: 'gemini-3.5-flash-lite', tldr: 'gemini-3.5-flash-lite', strategy: 'gemini-3.6-flash', embedding: 'gemini-embedding-001' },
    quality: { orchestrator: 'gemini-3.6-flash', synthesis: 'gemini-2.5-pro', reranker: 'gemini-3.6-flash', tldr: 'gemini-3.5-flash-lite', strategy: 'gemini-3.6-flash', embedding: 'gemini-embedding-001' },
  },
  groq: {
    economy: { orchestrator: 'openai/gpt-oss-20b', synthesis: 'openai/gpt-oss-20b', reranker: 'llama-3.1-8b-instant', tldr: 'llama-3.1-8b-instant', strategy: 'openai/gpt-oss-20b', embedding: 'text-embedding-3-small' },
    balanced: { orchestrator: 'openai/gpt-oss-120b', synthesis: 'openai/gpt-oss-120b', reranker: 'openai/gpt-oss-120b', tldr: 'openai/gpt-oss-20b', strategy: 'openai/gpt-oss-120b', embedding: 'text-embedding-3-small' },
    quality: { orchestrator: 'llama-3.3-70b-versatile', synthesis: 'llama-3.3-70b-versatile', reranker: 'openai/gpt-oss-120b', tldr: 'openai/gpt-oss-20b', strategy: 'openai/gpt-oss-120b', embedding: 'text-embedding-3-small' },
  },
};

export const PROVIDERS = Object.fromEntries(
  (Object.keys(MODEL_CATALOG) as LlmProvider[]).map((provider) => [
    provider,
    {
      label: provider === 'google' ? 'Google Gemini' : provider === 'openai' ? 'OpenAI' : 'Groq',
      envKey: provider === 'google' ? 'GOOGLE_GENERATIVE_AI_API_KEY' : provider === 'openai' ? 'OPENAI_API_KEY' : 'GROQ_API_KEY',
      models: Object.fromEntries(
        (['orchestrator', 'synthesis', 'reranker', 'tldr', 'strategy', 'embedding'] as LlmTask[]).map((task) => [task, MODEL_CATALOG[provider].filter((model) => model.allowedTasks.includes(task)).map((model) => model.id)])
      ) as Record<LlmTask, string[]>,
    },
  ])
) as Record<LlmProvider, { label: string; envKey: string; models: Record<LlmTask, string[]> }>;

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && value in MODEL_CATALOG;
}

export function isLlmPreset(value: unknown): value is LlmPreset {
  return value === 'economy' || value === 'balanced' || value === 'quality';
}

export function presetModels(provider: LlmProvider, preset: LlmPreset) {
  return { ...PRESETS[provider][preset] };
}

export function isModelAllowed(provider: LlmProvider, task: LlmTask, modelId: string) {
  if (provider === 'groq' && task === 'embedding') return modelId === 'text-embedding-3-small';
  return MODEL_CATALOG[provider].some((model) => model.id === modelId && model.allowedTasks.includes(task) && model.stable);
}

export function validateModels(provider: LlmProvider, models: Record<string, string>) {
  return Object.entries(models).every(([task, model]) =>
    (['orchestrator', 'synthesis', 'reranker', 'tldr', 'strategy', 'embedding'] as string[]).includes(task)
      && isModelAllowed(provider, task as LlmTask, model)
  );
}

export function defaultModel(provider: LlmProvider, task: LlmTask) {
  return PRESETS[provider].balanced[task];
}

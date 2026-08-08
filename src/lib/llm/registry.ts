export type LlmProvider = 'google' | 'openai' | 'groq';
export type LlmTask = 'orchestrator' | 'synthesis' | 'reranker' | 'tldr' | 'strategy' | 'embedding';

export const PROVIDERS: Record<
  LlmProvider,
  {
    label: string;
    envKey: string;
    models: Record<LlmTask, string[]>;
  }
> = {
  google: {
    label: 'Google Gemini',
    envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    models: {
      orchestrator: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      synthesis: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      reranker: ['gemini-2.5-flash-lite', 'gemini-1.5-flash'],
      tldr: ['gemini-2.5-flash-lite', 'gemini-1.5-flash'],
      strategy: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
      embedding: ['gemini-embedding-001'],
    },
  },
  openai: {
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: {
      orchestrator: ['gpt-4o', 'gpt-4o-mini'],
      synthesis: ['gpt-4o', 'gpt-4o-mini'],
      reranker: ['gpt-4o-mini'],
      tldr: ['gpt-4o-mini'],
      strategy: ['gpt-4o-mini'],
      embedding: ['text-embedding-3-small'],
    },
  },
  groq: {
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    models: {
      orchestrator: ['llama-3.3-70b-versatile'],
      synthesis: ['llama-3.3-70b-versatile'],
      reranker: ['llama-3.1-8b-instant'],
      tldr: ['llama-3.1-8b-instant'],
      strategy: ['llama-3.1-8b-instant'],
      embedding: [],
    },
  },
};

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && value in PROVIDERS;
}

export function defaultModel(provider: LlmProvider, task: LlmTask) {
  return PROVIDERS[provider].models[task][0] ?? PROVIDERS.google.models[task][0];
}

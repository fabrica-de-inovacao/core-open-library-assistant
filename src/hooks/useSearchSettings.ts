'use client';

/**
 * hooks/useSearchSettings.ts
 *
 * Gerencia as preferências de busca persistidas em localStorage:
 * - searchLimit (10 | 25 artigos por busca)
 * - modelId (modelo Gemini selecionado)
 *
 * Centraliza também as constantes de modelo para evitar duplicação com page.tsx.
 */

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Constantes exportadas — única fonte da verdade para MODEL_OPTIONS
// ---------------------------------------------------------------------------

export const MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Equilibrado (padrão)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Alta qualidade' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Econômico' },
  {
    value: 'gemini-2.5-flash-lite-preview-04-17',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Testes (lite)',
  },
] as const;

export type ModelValue = (typeof MODEL_OPTIONS)[number]['value'];
export const DEFAULT_MODEL: ModelValue = 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSearchSettingsReturn {
  searchLimit: 10 | 25;
  setSearchLimit: React.Dispatch<React.SetStateAction<10 | 25>>;
  modelId: ModelValue;
  setModelId: (m: ModelValue) => void;
}

export function useSearchSettings(): UseSearchSettingsReturn {
  // ── searchLimit ─────────────────────────────────────────────────────────
  // Inicia sempre com o default fixo (25) para garantir Server/Client match na
  // hidratação. O valor real do localStorage é aplicado num useEffect (client-only).
  const [searchLimit, setSearchLimit] = useState<10 | 25>(25);

  useEffect(() => {
    const sync = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('sol-settings') ?? '{}') as {
          articlesPerSearch?: number;
        };
        const next = stored.articlesPerSearch === 10 ? 10 : 25;
        setSearchLimit((prev) => (prev !== next ? next : prev));
      } catch {
        /* ignora */
      }
    };
    // Sincroniza na montagem (valor do localStorage) e quando a aba volta ao foco
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  // ── modelId ──────────────────────────────────────────────────────────────
  // Mesmo padrão: default fixo no useState, sync do localStorage no useEffect.
  const [modelId, setModelIdState] = useState<ModelValue>(DEFAULT_MODEL);

  useEffect(() => {
    const stored = localStorage.getItem('sol-model') as ModelValue | null;
    if (stored && stored !== DEFAULT_MODEL) setModelIdState(stored);
  }, []);

  const setModelId = (m: ModelValue) => {
    setModelIdState(m);
    localStorage.setItem('sol-model', m);
  };

  return { searchLimit, setSearchLimit, modelId, setModelId };
}

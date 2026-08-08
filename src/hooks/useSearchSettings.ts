'use client';

/**
 * hooks/useSearchSettings.ts
 *
 * Gerencia as preferências de busca persistidas em localStorage:
 * - analysisMode ('auto' | 'quick' | 'extended') — unifica searchLimit + synthesisMode
 *
 * Mapeamento de analysisMode:
 *   'quick'    → 10 artigos + síntese quick_lookup
 *   'extended' → 20 artigos + síntese systematic_review
 *   'auto'     → RouterAgent decide (10 por padrão, escalado pelo agente)
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Constantes exportadas — única fonte da verdade para MODEL_OPTIONS
// ---------------------------------------------------------------------------

export const MODEL_OPTIONS = [
  { value: 'user-settings', label: 'Configuração do usuário', description: 'Padrão' },
] as const;

export type ModelValue = (typeof MODEL_OPTIONS)[number]['value'];
export const DEFAULT_MODEL: ModelValue = 'user-settings';

// ---------------------------------------------------------------------------
// Analysis Mode — unifica searchLimit + synthesisMode em um único parâmetro
// ---------------------------------------------------------------------------

export type AnalysisMode = 'auto' | 'quick' | 'extended';

/** Mapeia o modo de análise para o número de artigos e modo de síntese correspondentes */
export function analysisModeToSettings(mode: AnalysisMode): {
  searchLimit: 10 | 20;
  synthesisMode: 'auto' | 'quick' | 'systematic';
} {
  switch (mode) {
    case 'quick':
      return { searchLimit: 10, synthesisMode: 'quick' };
    case 'extended':
      return { searchLimit: 20, synthesisMode: 'systematic' };
    case 'auto':
    default:
      return { searchLimit: 10, synthesisMode: 'auto' };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSearchSettingsReturn {
  /** Modo de análise unificado (auto / quick / extended) */
  analysisMode: AnalysisMode;
  setAnalysisMode: (m: AnalysisMode) => void;
  /** Número real de artigos derivado do analysisMode — para retrocompatibilidade */
  searchLimit: 10 | 20;
  modelId: ModelValue;
  setModelId: (m: ModelValue) => void;
}

export function useSearchSettings(): UseSearchSettingsReturn {
  // ── analysisMode ─────────────────────────────────────────────────────────
  // Lazy initializer: lê localStorage uma única vez antes do primeiro render (sem useEffect)
  const [analysisMode, setAnalysisModeState] = useState<AnalysisMode>(() => {
    if (typeof window === 'undefined') return 'auto';
    try {
      const stored = JSON.parse(localStorage.getItem('sol-settings') ?? '{}') as {
        analysisMode?: AnalysisMode;
        articlesPerSearch?: number;
      };
      if (stored.analysisMode && ['auto', 'quick', 'extended'].includes(stored.analysisMode)) {
        return stored.analysisMode;
      }
      if (stored.articlesPerSearch === 10) return 'quick';
      if (stored.articlesPerSearch === 25 || stored.articlesPerSearch === 20) return 'extended';
    } catch {
      /* ignora */
    }
    return 'auto';
  });

  const setAnalysisMode = (m: AnalysisMode) => {
    setAnalysisModeState(m);
    try {
      const stored = JSON.parse(localStorage.getItem('sol-settings') ?? '{}');
      localStorage.setItem('sol-settings', JSON.stringify({ ...stored, analysisMode: m }));
    } catch {
      /* ignora */
    }
  };

  const modelId = DEFAULT_MODEL;
  const setModelId = () => {};

  const { searchLimit } = analysisModeToSettings(analysisMode);

  return { analysisMode, setAnalysisMode, searchLimit, modelId, setModelId };
}

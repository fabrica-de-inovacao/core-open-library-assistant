'use client';

import { useCallback, useEffect, useState } from 'react';

export interface UserSettings {
  /** Idioma para geração de TL;DRs pelo Inngest. 'pt-BR' é o padrão. */
  tldrLanguage: 'pt-BR' | 'en-US' | 'es';
  /** Número máximo de artigos retornados por busca. */
  articlesPerSearch: 10 | 25;
  /** Se notification do browser deve ser emitida ao fim do processamento. */
  browserNotifications: boolean;
}

const STORAGE_KEY = 'sol-settings';

const DEFAULTS: UserSettings = {
  tldrLanguage: 'pt-BR',
  articlesPerSearch: 25,
  browserNotifications: false,
};

function loadFromStorage(): UserSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Hook de configurações do usuário persistidas via localStorage.
 *
 * Uso:
 * ```ts
 * const { settings, updateSetting } = useUserSettings();
 * updateSetting('tldrLanguage', 'en-US');
 * ```
 */
export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULTS);

  // Lê do localStorage apenas no cliente (após hidratação)
  useEffect(() => {
    setSettings(loadFromStorage());
  }, []);

  const updateSetting = useCallback(
    <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSettings(DEFAULTS);
  }, []);

  return { settings, updateSetting, resetSettings };
}

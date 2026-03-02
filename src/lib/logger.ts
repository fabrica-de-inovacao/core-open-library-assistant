/**
 * Logger global com controle por variável de ambiente.
 *
 * .env:
 *   LOG_MODE=development  → logs verbosos, debug e chunk (padrão fora de produção)
 *   LOG_MODE=production   → apenas info, warn e error
 *
 * NODE_ENV é usado como fallback quando LOG_MODE não está definido.
 *
 * Uso:
 *   import { logger } from '@/lib/logger';
 *   logger.info('[Chat]', 'request recebido');
 *   logger.debug('[Chat]', 'payload interno', dados);   // só em dev
 *   logger.chunk('text-delta', { text: '...' });        // só em dev
 *   logger.warn('[Chat]', 'algo suspeito');
 *   logger.error('[Chat]', 'falha crítica', err);
 */

const mode =
  process.env.LOG_MODE ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const isDev = mode !== 'production';

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

export const logger = {
  /** Informações operacionais — sempre visível */
  info: (...args: unknown[]): void => {
    console.log(`[${ts()}][INFO ]`, ...args);
  },

  /** Debug verboso — apenas LOG_MODE=development */
  debug: (...args: unknown[]): void => {
    if (!isDev) return;
    console.log(`[${ts()}][DEBUG]`, ...args);
  },

  /** Cada chunk do stream AI — apenas LOG_MODE=development */
  chunk: (type: string, data?: unknown): void => {
    if (!isDev) return;
    console.log(`[${ts()}][CHUNK] type=${type}`, data !== undefined ? data : '');
  },

  /** Avisos — sempre visível */
  warn: (...args: unknown[]): void => {
    console.warn(`[${ts()}][WARN ]`, ...args);
  },

  /** Erros críticos — sempre visível */
  error: (...args: unknown[]): void => {
    console.error(`[${ts()}][ERROR]`, ...args);
  },

  /** Alias backward-compat com o logger antigo */
  log: (...args: unknown[]): void => {
    if (!isDev) return;
    console.log(`[${ts()}][LOG  ]`, ...args);
  },

  isDebug: isDev,
};

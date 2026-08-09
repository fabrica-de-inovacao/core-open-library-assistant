import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Verifica se uma rota está ativa. Com `exact=true` exige igualdade exata. */
export function isActive(pathname: string, href: string, exact = false): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

/** Corte seguro de string prevenindo surrogate pairs quebrados (emojis). */
export function safeSlice(text: string | null | undefined, start: number, end?: number): string {
  if (!text) return '';
  return text.slice(start, end).toWellFormed();
}

/** Trunca texto com reticências. Retorna fallback se nulo/vazio. */
export function truncate(
  text: string | null | undefined,
  max = 26,
  fallback = 'Sessão sem título'
): string {
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max).toWellFormed()}…` : text.toWellFormed();
}

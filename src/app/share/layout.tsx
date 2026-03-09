/**
 * Layout compartilhado para rotas /share/**
 *
 * Marca a sub-árvore como dinâmica via connection(), impedindo que o PPR
 * tente pré-renderizar estas páginas em build time (o que causaria o erro
 * "Uncached data accessed outside <Suspense>" vindo do ThemeProvider).
 */
import { connection } from 'next/server';
import { Suspense } from 'react';

export default async function ShareLayout({ children }: { children: React.ReactNode }) {
  // Sinaliza ao Next.js 16 (PPR) que esta rota precisa de conexão live
  await connection();

  return <Suspense>{children}</Suspense>;
}

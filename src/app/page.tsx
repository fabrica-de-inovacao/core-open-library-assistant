import { redirect } from 'next/navigation';

/**
 * Rota raiz — redireciona todos os utilizadores para /workspace.
 * Não há landing page: o workspace é público (lazy login).
 */
export default function Home() {
  redirect('/workspace');
}

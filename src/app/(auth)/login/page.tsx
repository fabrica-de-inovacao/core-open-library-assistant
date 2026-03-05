import { redirect } from 'next/navigation';

/**
 * Página de login dedicada removida — login via modal inline no workspace.
 * Redireciona qualquer acesso direto para /workspace (lazy login flow).
 */
export default function LoginPage() {
  redirect('/workspace');
}

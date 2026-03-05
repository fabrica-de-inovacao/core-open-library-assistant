'use client';

/**
 * components/auth/LoginModal.tsx
 *
 * Modal de login acionado quando o utilizador tenta realizar uma ação
 * sem estar autenticado. Não redireciona para /login — tudo ocorre
 * aqui mesmo, via signIn('google').
 */

import { signIn } from 'next-auth/react';
import { Library } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface LoginModalProps {
  /** Controla visibilidade (Radix gerencia a state machine internamente) */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const handleSignIn = () => {
    void signIn('google', { callbackUrl: '/workspace' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent sempre montado — Radix controla visibilidade internamente */}
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          {/* Ícone */}
          <div className="bg-primary text-primary-foreground shadow-primary/20 mb-3 flex size-12 items-center justify-center rounded-xl shadow-lg">
            <Library className="size-6" />
          </div>

          <DialogTitle className="text-center">Acesse para continuar</DialogTitle>

          <DialogDescription className="text-center text-sm">
            Para pesquisar e salvar sua revisão sistemática, faça login com sua conta Google.
          </DialogDescription>
        </DialogHeader>

        {/* Botão Google — mesmo estilo visual da antiga /login */}
        <button
          type="button"
          onClick={handleSignIn}
          className="border-border bg-background text-foreground hover:bg-accent focus-visible:ring-primary mt-2 flex h-12 w-full items-center justify-center gap-3 rounded-full border px-4 py-2.5 text-base font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:outline-none"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Entrar com Google
        </button>
      </DialogContent>
    </Dialog>
  );
}

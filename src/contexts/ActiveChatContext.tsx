'use client';

/**
 * contexts/ActiveChatContext.tsx
 *
 * Ponto de controle central para o ciclo de vida do chat ativo.
 * Responsabilidades:
 *  - Expõe `chatIsLocked` (true quando uma busca/síntese está em andamento)
 *  - Expõe `requestNavigation(path)`: bloqueia navegação se chatIsLocked, mostrando modal de confirmação
 *  - Expõe `cancelAndNavigate()`: cancela a busca ativa e navega
 *  - Expõe `registerCancelFn(fn)`: usado pelo useChatOrchestration para registrar a função de cancelamento
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveChatContextValue {
  /** True quando uma busca ou síntese está em andamento — bloqueia navegação */
  chatIsLocked: boolean;
  /** Caminho de destino pendente (aguardando confirmação do usuário) */
  pendingNavPath: string | null;
  /** Tenta navegar — se chatIsLocked, exibe modal de confirmação */
  requestNavigation: (path: string) => void;
  /** Confirma cancelamento e navega para pendingNavPath */
  confirmCancelAndNavigate: () => Promise<void>;
  /** Descarta o modal sem navegar */
  dismissNavigationModal: () => void;
  /**
   * Registra a função de cancelamento da busca ativa.
   * Chamado por `useChatOrchestration` quando inicia/termina uma busca.
   */
  registerCancelFn: (fn: (() => Promise<void>) | null) => void;
  /** Atualiza o estado de lock (chamado pelo useChatOrchestration) */
  setLocked: (locked: boolean) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [chatIsLocked, setChatIsLocked] = useState(false);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);
  const cancelFnRef = useRef<(() => Promise<void>) | null>(null);

  const setLocked = useCallback((locked: boolean) => {
    setChatIsLocked(locked);
    // Se desbloqueado, não há mais necessidade de guardar caminho pendente
    if (!locked) setPendingNavPath(null);
  }, []);

  const registerCancelFn = useCallback((fn: (() => Promise<void>) | null) => {
    cancelFnRef.current = fn;
  }, []);

  const requestNavigation = useCallback(
    (path: string) => {
      if (!chatIsLocked) {
        router.push(path);
        return;
      }
      // Está bloqueado: guarda o destino e exibe modal
      setPendingNavPath(path);
    },
    [chatIsLocked, router]
  );

  const confirmCancelAndNavigate = useCallback(async () => {
    // Executa cancelamento da busca ativa (se registrado)
    if (cancelFnRef.current) {
      try {
        await cancelFnRef.current();
      } catch (e) {
        console.error('[ActiveChatContext] Erro ao cancelar busca:', e);
      }
    }
    const target = pendingNavPath;
    setPendingNavPath(null);
    setChatIsLocked(false);
    if (target) router.push(target);
  }, [pendingNavPath, router]);

  const dismissNavigationModal = useCallback(() => {
    setPendingNavPath(null);
  }, []);

  return (
    <ActiveChatContext.Provider
      value={{
        chatIsLocked,
        pendingNavPath,
        requestNavigation,
        confirmCancelAndNavigate,
        dismissNavigationModal,
        registerCancelFn,
        setLocked,
      }}
    >
      {children}

      {/* Modal de confirmação de navegação — renderizado no provider para estar sempre disponível */}
      {pendingNavPath && (
        <NavigationGuardModal
          onConfirm={confirmCancelAndNavigate}
          onDismiss={dismissNavigationModal}
        />
      )}
    </ActiveChatContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Modal de Confirmação
// ---------------------------------------------------------------------------

function NavigationGuardModal({
  onConfirm,
  onDismiss,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="bg-background border-border mx-4 w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ícone */}
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
          <span className="text-2xl">⚠️</span>
        </div>

        <h2 className="text-foreground mb-1 text-[16px] font-semibold">Busca em andamento</h2>
        <p className="text-muted-foreground mb-5 text-[13px] leading-relaxed">
          Há uma busca ou síntese em progresso. Ao sair agora, o processamento será{' '}
          <strong>cancelado</strong> e os artigos incompletos serão perdidos.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            className="border-border hover:bg-muted flex-1 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-colors"
          >
            Continuar aqui
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-rose-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-rose-600"
          >
            Cancelar e sair
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActiveChat() {
  const ctx = useContext(ActiveChatContext);
  if (!ctx) {
    throw new Error('useActiveChat must be used within ActiveChatProvider');
  }
  return ctx;
}

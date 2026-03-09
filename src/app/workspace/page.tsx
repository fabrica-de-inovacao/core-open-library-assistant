'use client';

/**
 * app/workspace/page.tsx
 *
 * Orquestrador do Workspace — responsabilidade única:
 * instanciar os hooks globais e decidir qual vista renderizar.
 *
 * Camadas de separação:
 *   settings (model/limit)         → useSearchSettings
 *   chat + busca + artigos         → useChatOrchestration
 *   upload PDF / DOI / drag & drop → useAttachments
 *   cabeçalho fixo                 → WorkspaceHeader
 *   tela inicial (sem sessão)      → HomeView
 *   sessão de chat activa          → ChatView
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type UIMessage } from 'ai';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader';
import { HomeView } from '@/components/workspace/home/HomeView';
import { ChatView } from '@/components/workspace/chat/ChatView';
import { LoginModal } from '@/components/auth/LoginModal';
import { SimilarChatModal } from '@/components/workspace/SimilarChatModal';
import { useChatOrchestration } from '@/hooks/useChatOrchestration';
import { useSearchSettings } from '@/hooks/useSearchSettings';
import { useAttachments } from '@/hooks/useAttachments';
import { useActiveChat } from '@/contexts/ActiveChatContext';
import { useRecentChats } from '@/hooks/useRecentChats';
import { findSimilarChat } from '@/hooks/useSimilarChatDetection';
import type { RecentChat } from '@/server/actions/chat';

// ---------------------------------------------------------------------------
// Wrapper público exportado pela rota Next.js
// ---------------------------------------------------------------------------

export default function WorkspacePage({ initialMessages }: { initialMessages?: UIMessage[] }) {
  return (
    <Suspense fallback={<div>Loading workspace…</div>}>
      <WorkspaceShellKeyed initialMessages={initialMessages} />
    </Suspense>
  );
}

/**
 * Wrapper que lê o chatId da rota e repassa como `key` ao WorkspaceShell.
 * Isso garante que o React desmonta/remonta toda a árvore ao trocar de chat,
 * eliminando vazamento de estado entre sessões (BUG-01 + BUG-02).
 */
function WorkspaceShellKeyed({ initialMessages }: { initialMessages?: UIMessage[] }) {
  const routeParams = useParams<{ chatId?: string }>();
  return <WorkspaceShell key={routeParams.chatId ?? 'home'} initialMessages={initialMessages} />;
}

// ---------------------------------------------------------------------------
// WorkspaceShell
// Instancia os hooks de domínio e distribui entre as duas vistas.
// Não contém estado de UI nem lógica de renderização de mensagens.
// ---------------------------------------------------------------------------

function WorkspaceShell({ initialMessages }: { initialMessages?: UIMessage[] }) {
  const { data: session, status: authStatus } = useSession();
  const routeParams = useParams<{ chatId?: string }>();
  const router = useRouter();

  // ── Settings (modelo de IA + modo de análise) ────────────────────────────
  const { analysisMode, setAnalysisMode, searchLimit, modelId, setModelId } = useSearchSettings();

  // ── Chats recentes (para detecção de similaridade FEAT-01) ─────────────
  const { chats: recentChats } = useRecentChats(session?.user?.id);

  // ── Estado do modal de chat similar ──────────────────────────────────────
  const [similarModalState, setSimilarModalState] = useState<{
    open: boolean;
    query: string;
    similarChat: RecentChat | null;
  }>({ open: false, query: '', similarChat: null });
  // Guarda o callback que inicia a busca real (chamado depois do modal de similar)
  const pendingSearchRef = useRef<(() => void) | null>(null);

  // ── Integração com ActiveChatContext (guarda de navegação) ────────────────
  const { setLocked, registerCancelFn } = useActiveChat();

  // ── Orquestração de chat (mensagens, buscas, artigos, realtime) ──────────
  const orchestration = useChatOrchestration({
    urlQueryId: routeParams.chatId,
    initialMessages,
    authStatus,
    modelId,
    searchLimitOverride: searchLimit,
  });

  // Mantém o lock do ActiveChatContext sincronizado com o estado de busca
  useEffect(() => {
    setLocked(orchestration.isSearchRunning || orchestration.isSynthesisRunning);
  }, [orchestration.isSearchRunning, orchestration.isSynthesisRunning, setLocked]);

  // Registra a função de cancelamento para uso pelo modal de navegação
  useEffect(() => {
    registerCancelFn(async () => {
      if (orchestration.isSearchRunning && orchestration.activeQueryId) {
        await orchestration.handleCancelSearch(orchestration.activeQueryId);
      }
      orchestration.stop();
    });
    return () => registerCancelFn(null);
  }, [orchestration, registerCancelFn]);

  // ── Anexos (PDF, DOI, drag & drop) ──────────────────────────────────────
  const attachments = useAttachments({
    chatId: orchestration.chatId,
    addWatchedQueryId: orchestration.addWatchedQueryId,
    refreshArticles: orchestration.refreshArticles,
  });

  // ── Decisão de vista ────────────────────────────────────────────────────
  const hasActiveSession =
    orchestration.displayMessages.length > 0 || !!orchestration.sessionQueryId;

  // Título da sessão — derivado da primeira mensagem do utilizador (parts API do AI SDK)
  const sessionTitle = useMemo(() => {
    const first = orchestration.displayMessages.find((m) => m.role === 'user');
    if (!first) return undefined;
    const textPart = first.parts?.find(
      (p): p is { type: 'text'; text: string } => p.type === 'text'
    );
    return textPart?.text.trim().slice(0, 65) || undefined;
  }, [orchestration.displayMessages]);

  // ── Modal de login (lazy login) ─────────────────────────────────────────
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  /**
   * Ao montar (ou quando authStatus muda para 'authenticated'), verifica se
   * havia uma query pendente gravada no sessionStorage antes do redirect OAuth.
   * Se sim, retoma automaticamente e limpa o armazenamento.
   */
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const pending = sessionStorage.getItem('core-pending-query');
    if (!pending) return;
    sessionStorage.removeItem('core-pending-query');
    orchestration.sendMessage({ text: pending });
    attachments.clearChips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // ── Handlers ────────────────────────────────────────────────────────────

  /**
   * Chamado por HomeView/ChatView quando o utilizador está não-autenticado
   * e tenta agir. Guarda o texto pendente no sessionStorage e abre o modal.
   */
  const handleShowLoginModal = (pendingText?: string) => {
    if (pendingText) sessionStorage.setItem('core-pending-query', pendingText);
    setLoginModalOpen(true);
  };

  /** Recebe o texto submetido pela HomeView e inicia a sessão de chat */
  const handleHomeSubmit = useCallback(
    (text: string) => {
      if (authStatus === 'unauthenticated') {
        handleShowLoginModal(text);
        return;
      }
      // FEAT-01: verifica se há um chat similar antes de iniciar
      const similar = findSimilarChat(text, recentChats, routeParams.chatId);
      if (similar) {
        // Guarda a função de inicio para ser chamada se o utilizador escolher "nova busca"
        pendingSearchRef.current = () => {
          orchestration.sendMessage({ text });
          attachments.clearChips();
        };
        setSimilarModalState({ open: true, query: text, similarChat: similar.chat });
        return;
      }
      // Sem chat similar — busca direta
      orchestration.sendMessage({ text });
      attachments.clearChips();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authStatus, recentChats, routeParams.chatId]
  );

  // =========================================================================
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Input de ficheiro oculto — montado uma única vez no topo para drag & drop */}
      <input
        ref={attachments.fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={attachments.handleFileSelect}
      />

      {/* Cabeçalho — apenas no modo chat (não exibido na home) */}
      {hasActiveSession && (
        <WorkspaceHeader
          hasActiveSession={hasActiveSession}
          modelId={modelId}
          onModelChange={setModelId}
          chatId={orchestration.chatId}
          sessionTitle={sessionTitle}
          articleCount={orchestration.articles.length}
          isSearchRunning={orchestration.isSearchRunning}
        />
      )}

      {/* Vista inicial (sem sessão activa) */}
      {!hasActiveSession && (
        <HomeView
          onSubmitQuery={handleHomeSubmit}
          isLoading={orchestration.isLoading}
          authStatus={authStatus}
          attachments={attachments}
          analysisMode={analysisMode}
          onAnalysisModeChange={setAnalysisMode}
          modelId={modelId}
          onModelChange={setModelId}
          onShowLoginModal={handleShowLoginModal}
        />
      )}

      {/* Vista de chat activa */}
      {hasActiveSession && (
        <ChatView
          userName={session?.user?.name}
          authStatus={authStatus}
          orchestration={orchestration}
          attachments={attachments}
          analysisMode={analysisMode}
          onAnalysisModeChange={setAnalysisMode}
          modelId={modelId}
          onModelChange={setModelId}
          onShowLoginModal={handleShowLoginModal}
        />
      )}

      {/* Modal de login — sempre montado, Radix controla visibilidade */}
      <LoginModal open={loginModalOpen} onOpenChange={setLoginModalOpen} />

      {/* FEAT-01: Modal de chat similar */}
      <SimilarChatModal
        open={similarModalState.open}
        query={similarModalState.query}
        similarChat={similarModalState.similarChat}
        onGoToOldChat={() => {
          setSimilarModalState((s) => ({ ...s, open: false }));
          if (similarModalState.similarChat) {
            router.push(`/workspace/chat/${similarModalState.similarChat.id}`);
          }
        }}
        onStartNew={() => {
          setSimilarModalState((s) => ({ ...s, open: false }));
          pendingSearchRef.current?.();
          pendingSearchRef.current = null;
        }}
        onCancel={() => {
          setSimilarModalState((s) => ({ ...s, open: false }));
          pendingSearchRef.current = null;
        }}
      />
    </div>
  );
}

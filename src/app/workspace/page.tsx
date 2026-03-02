'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { UIMessage } from 'ai';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Send,
  Loader2,
  Search,
  Library,
  PlusCircle,
  GraduationCap,
  Layers,
  FlaskConical,
  Zap,
} from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useSession, signIn } from 'next-auth/react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { ChatMessageItem, TypingIndicator } from '@/components/workspace/ChatMessageItem';
import { ExtractionsPanel } from '@/components/workspace/ExtractionsPanel';
import { ShareDialog } from '@/components/ShareDialog';
import { useChatOrchestration } from '@/hooks/useChatOrchestration';

export default function WorkspacePage({ initialMessages }: { initialMessages?: UIMessage[] }) {
  return (
    <Suspense fallback={<div>Loading workspace...</div>}>
      <WorkspaceContent initialMessages={initialMessages} />
    </Suspense>
  );
}

/**
 * WorkspaceContent — componente responsivo do workspace.
 * P-06: Lógica de orquestração extraída para useChatOrchestration hook.
 * Este componente foca apenas na renderização e interação do usuário.
 */
function WorkspaceContent({ initialMessages }: { initialMessages?: UIMessage[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const searchParamQueryId = searchParams?.get('q');
  const pathQueryId = params?.id as string | undefined;
  const urlQueryId = pathQueryId || searchParamQueryId;

  const [highlightedRow, setHighlightedRowState] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [input, setInput] = useState('');

  const setHighlightedRow = useCallback((value: string | null) => {
    setHighlightedRowState(value);
  }, []);

  const { data: session, status: authStatus } = useSession();
  const userName = session?.user?.name;

  // P-06: toda a lógica de chat/busca/artigos está no hook
  const {
    messages,
    displayMessages,
    sendMessage,
    setMessages,
    isLoading,
    chatId,
    activeQueryId,
    handleExecuteSearch,
    executedProposalIds,
    runningSearches,
    displayArticles,
    panelQueryId,
    hasArticles,
    realtimeStatus,
    hasZeroResults,
    isSearchRunning,
  } = useChatOrchestration({
    urlQueryId: urlQueryId ?? undefined,
    initialMessages,
    authStatus,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!input.trim()) return;
    if (authStatus === 'unauthenticated') {
      setShowLoginModal(true);
      return;
    }
    sendMessage({ text: input });
    setInput('');
  };

  // P-08: Auto-scroll que acompanha streaming (roda em cada mudança de messages)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  return (
    <div className="bg-background text-foreground flex h-screen w-full flex-col overflow-hidden font-sans">
      {/* Top Header */}
      <header className="border-border bg-background flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          <div className="bg-border h-4 w-px" />
          <div className="flex items-center gap-2">
            <Search className="text-primary h-4 w-4" />
            <span className="text-foreground/80 text-sm font-semibold tracking-tight">
              Workspace
            </span>
          </div>
        </div>
        {activeQueryId && <ShareDialog queryId={activeQueryId} />}
      </header>

      {/* Main Content Area */}
      {messages.length === 0 && !activeQueryId ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 px-10">
          <div className="w-full max-w-3xl text-center">
            <h1 className="text-foreground mb-4 text-4xl font-semibold tracking-tight">
              O que você quer pesquisar hoje?
            </h1>
            <p className="text-muted-foreground mb-8 text-lg">
              Descreva sua necessidade em linguagem natural. Nós estruturamos a revisão sistemática
              ibero-americana perfeita.
            </p>

            <form
              onSubmit={handleSubmit}
              className="relative mx-auto flex w-full max-w-2xl items-center shadow-lg"
            >
              <Search className="text-muted-foreground absolute left-4 h-5 w-5" />
              <Input
                value={input}
                onChange={handleInputChange}
                placeholder="Ex: Procure artigos sobre IA na educação básica..."
                className="border-border bg-muted/30 focus-visible:bg-background focus-visible:ring-primary h-16 rounded-full pr-14 pl-12 text-base shadow-sm backdrop-blur transition-all focus-visible:ring-2"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 absolute top-2 right-2 h-12 w-12 rounded-full shadow-sm transition-all hover:scale-105"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </form>

            <div className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'IA na educação básica brasileira', Icon: GraduationCap },
                { label: 'Gamificação no ensino de engenharia', Icon: Layers },
                { label: 'Acessibilidade em interfaces web', Icon: FlaskConical },
                { label: 'Metodologias ágeis em startups', Icon: Zap },
              ].map(({ label, Icon }) => (
                <button
                  key={label}
                  onClick={() => {
                    setInput(label);
                    if (authStatus === 'unauthenticated') {
                      setShowLoginModal(true);
                    }
                  }}
                  className="border-border bg-card hover:bg-accent group hover:border-primary/40 focus-visible:ring-primary flex flex-col items-start justify-between rounded-xl border p-4 text-left shadow-sm transition-all focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Icon className="text-primary/50 group-hover:text-primary mb-3 h-4 w-4 transition-colors" />
                  <span className="text-foreground/80 text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="w-full flex-1">
          {/* LEFT PANEL: Chat */}
          <ResizablePanel
            defaultSize={hasArticles || isSearchRunning ? 40 : 100}
            minSize={30}
            className={`bg-background flex flex-col ${!hasArticles ? 'border-border/50 mx-auto max-w-4xl border-x shadow-sm' : ''}`}
          >
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-6">
              <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-6">
                {displayMessages.map((m: UIMessage) => {
                  const isLastInTotal =
                    messages.length > 0 && m.id === messages[messages.length - 1].id;
                  const isStreaming = isLoading && isLastInTotal && m.role === 'assistant';

                  return (
                    <div
                      key={m.id}
                      className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500"
                    >
                      <ChatMessageItem
                        m={m}
                        setHighlightedRow={setHighlightedRow}
                        articles={displayArticles}
                        isStreaming={isStreaming}
                        userName={userName}
                        onExecuteSearch={handleExecuteSearch}
                        executedProposalIds={executedProposalIds}
                        runningSearches={runningSearches}
                      />
                    </div>
                  );
                })}
                {isLoading &&
                  displayMessages.length > 0 &&
                  displayMessages.at(-1)?.role === 'user' && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Chat Input */}
            <div className="border-border bg-background border-t p-4">
              <form onSubmit={handleSubmit} className="relative mx-auto flex max-w-2xl gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setMessages([]);
                    router.push('/workspace');
                  }}
                  title="Nova Busca"
                  className="text-muted-foreground hover:text-primary h-12 w-12 rounded-lg"
                >
                  <PlusCircle className="h-5 w-5" />
                </Button>
                <div className="relative flex-1">
                  <Input
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Resposta ou nova iteração..."
                    className="border-border bg-card text-foreground focus-visible:border-primary focus-visible:ring-primary h-12 rounded-lg pr-24 font-sans text-sm shadow-sm transition-all focus-visible:ring-1"
                    disabled={isLoading}
                  />
                  <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-2">
                    <div className="text-muted-foreground mr-1 hidden items-center gap-1 font-mono text-[10px] sm:flex">
                      <kbd className="bg-muted rounded border px-1">Ctrl</kbd>
                      <span>+</span>
                      <kbd className="bg-muted rounded border px-1">Enter</kbd>
                    </div>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={isLoading || !input.trim()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary h-9 w-9 rounded-md shadow-sm transition-all focus-visible:ring-2"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </ResizablePanel>

          {(hasArticles || isSearchRunning) && (
            <>
              <ResizableHandle
                withHandle
                className="bg-border hover:bg-primary/40 w-1 transition-colors"
              />
              <ResizablePanel
                defaultSize={60}
                minSize={30}
                className="animate-in fade-in slide-in-from-right-4 fill-mode-both duration-700"
              >
                <ExtractionsPanel
                  articles={displayArticles}
                  activeQueryId={panelQueryId}
                  highlightedRow={highlightedRow}
                  hasZeroResults={hasZeroResults}
                  isSearchRunning={isSearchRunning}
                  realtimeStatus={realtimeStatus}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}

      {/* Login Modal */}
      <Dialog open={showLoginModal} onOpenChange={setShowLoginModal}>
        <DialogContent className="border-border bg-card overflow-hidden p-0 shadow-2xl sm:max-w-md">
          <div className="flex flex-col items-center justify-center p-8 text-center sm:p-10">
            <div className="bg-primary text-primary-foreground shadow-primary/20 mb-4 flex aspect-square size-12 items-center justify-center rounded-xl shadow-lg">
              <Library className="size-6" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-foreground mb-2 font-sans text-xl font-bold tracking-tight">
                SOL Open Library Assistant
              </DialogTitle>
              <DialogDescription className="text-muted-foreground mx-auto max-w-sm text-sm">
                Acesse para pesquisar e gerenciar suas revisões sistemáticas da literatura.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-8 w-full max-w-xs">
              <Button
                onClick={() => signIn('google', { redirectTo: '/workspace' })}
                className="border-border bg-background text-foreground hover:bg-accent focus-visible:ring-primary flex h-12 w-full items-center justify-center gap-3 rounded-full border text-base font-medium shadow-sm transition-all focus-visible:ring-2"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
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
                Continuar com Google
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

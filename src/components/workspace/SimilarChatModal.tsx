'use client';

/**
 * components/workspace/SimilarChatModal.tsx
 *
 * FEAT-01: Modal exibido quando uma busca nova parece similar a um chat anterior.
 * Pergunta ao utilizador se quer ir ao chat antigo ou iniciar uma nova busca.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { History, Search, Sparkles } from 'lucide-react';
import type { RecentChat } from '@/server/actions/chat';

interface SimilarChatModalProps {
  open: boolean;
  query: string;
  similarChat: RecentChat | null;
  /** Navega para o chat antigo */
  onGoToOldChat: () => void;
  /** Inicia a busca nova do zero */
  onStartNew: () => void;
  /** Fecha sem fazer nada */
  onCancel: () => void;
}

export function SimilarChatModal({
  open,
  query,
  similarChat,
  onGoToOldChat,
  onStartNew,
  onCancel,
}: SimilarChatModalProps) {
  if (!similarChat) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary h-4 w-4 shrink-0" />
            Busca similar encontrada
          </DialogTitle>
          <DialogDescription className="text-left">
            Você já pesquisou por algo parecido antes. Quer ver o resultado anterior ou iniciar uma
            nova busca?
          </DialogDescription>
        </DialogHeader>

        {/* Query atual */}
        <div className="border-border/60 bg-muted/40 rounded-lg border p-3">
          <p className="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase">
            Sua nova busca
          </p>
          <p className="text-foreground text-[13px] leading-snug font-medium">
            &ldquo;{query}&rdquo;
          </p>
        </div>

        {/* Chat similar */}
        <div className="border-primary/20 bg-primary/5 rounded-lg border p-3">
          <p className="text-primary/70 mb-1 text-[11px] font-medium tracking-wide uppercase">
            Chat anterior similar
          </p>
          <p className="text-foreground text-[13px] leading-snug font-medium">
            &ldquo;{similarChat.title}&rdquo;
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {new Date(similarChat.updatedAt).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Ações */}
        <div className="flex flex-col gap-2 pt-1">
          <Button onClick={onGoToOldChat} className="w-full gap-2">
            <History className="h-4 w-4" />
            Ver chat anterior
          </Button>
          <Button onClick={onStartNew} variant="outline" className="w-full gap-2">
            <Search className="h-4 w-4" />
            Iniciar nova busca mesmo assim
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

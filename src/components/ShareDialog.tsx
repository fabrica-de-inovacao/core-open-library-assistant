'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Share2, Check, Copy, ExternalLink } from 'lucide-react';

interface ShareDialogProps {
  chatId: string;
  /** Modo controlado: controla abertura externamente */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ShareDialog({ chatId, open, onOpenChange }: ShareDialogProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/share/chat/${chatId}`
      : `/share/chat/${chatId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para browsers sem clipboard API
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Modo controlado vs. modo com trigger interno
  const isControlled = open !== undefined;

  return (
    <Dialog
      open={isControlled ? open : undefined}
      onOpenChange={isControlled ? onOpenChange : undefined}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Share2 className="size-3.5" />
            Compartilhar
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Compartilhar Sessão</DialogTitle>
          <DialogDescription className="sr-only">
            Copie o link para compartilhar toda a sessão de pesquisa com outras pessoas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <p className="text-muted-foreground text-sm">
            Qualquer pessoa com este link pode visualizar <strong>todas as buscas e artigos</strong>{' '}
            desta sessão — <strong>sem precisar fazer login</strong>.
          </p>

          <div className="flex gap-2">
            <Input
              readOnly
              value={shareUrl}
              className="font-mono text-xs"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              className="shrink-0"
              title="Copiar link"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full gap-2 text-xs"
            asChild
          >
            <a href={shareUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Abrir prévia em nova aba
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

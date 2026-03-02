'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Share2, Check, Copy, ExternalLink } from 'lucide-react';

interface ShareDialogProps {
  queryId: string;
}

export function ShareDialog({ queryId }: ShareDialogProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/share/${queryId}`
      : `/share/${queryId}`;

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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Share2 className="size-3.5" />
          Compartilhar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Compartilhar Revisão</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <p className="text-muted-foreground text-sm">
            Qualquer pessoa com este link pode visualizar os artigos e TL;DRs desta pesquisa —{' '}
            <strong>sem precisar fazer login</strong>.
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

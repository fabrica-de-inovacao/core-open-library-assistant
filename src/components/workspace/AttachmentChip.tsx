'use client';

/**
 * components/workspace/AttachmentChip.tsx
 *
 * Card de ficheiro anexado visível sobre o campo de input.
 * Usado tanto na HomeView como no ChatInputBar — componente único
 * em vez da duplicação inline que existia em page.tsx.
 */

import { Loader2, CheckCircle2, X } from 'lucide-react';

interface AttachmentChipProps {
  id: string;
  name: string;
  state: 'uploading' | 'done' | 'error';
  type: 'pdf' | 'doi';
  onRemove: (id: string) => void;
}

export function AttachmentChip({ id, name, state, type, onRemove }: AttachmentChipProps) {
  return (
    <div className="bg-muted/80 border-border/30 relative flex h-[76px] w-[90px] flex-col justify-between overflow-hidden rounded-xl border p-2.5">
      {/* Botão remover */}
      <button
        type="button"
        onClick={() => onRemove(id)}
        className="bg-background border-border/50 hover:bg-muted absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full border shadow-sm transition-colors"
      >
        <X className="h-2 w-2" />
      </button>

      {/* Nome do ficheiro */}
      <span className="mt-0.5 line-clamp-2 pr-3 text-[10px] leading-snug font-medium">
        {name.replace(/\.pdf$/i, '')}
      </span>

      {/* Estado + badge de tipo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {state === 'uploading' ? (
            <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
          ) : state === 'done' ? (
            <CheckCircle2 className="h-3 w-3 text-green-500" />
          ) : (
            <span className="text-destructive text-[9px] font-bold">ERR</span>
          )}
        </div>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white ${
            type === 'doi' ? 'bg-blue-600' : 'bg-red-600'
          }`}
        >
          {type === 'doi' ? 'DOI' : 'PDF'}
        </span>
      </div>
    </div>
  );
}

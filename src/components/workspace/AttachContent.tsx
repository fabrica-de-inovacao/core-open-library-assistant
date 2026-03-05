'use client';

/**
 * components/workspace/AttachContent.tsx
 *
 * UI partilhada de "Adicionar ao acervo" — drop zone de PDF + separador + campo DOI.
 * Usada tanto dentro do PopoverContent (HomeView) como dentro do Dialog (ChatInputBar).
 * Elimina a duplicação que existia em page.tsx.
 */

import { Loader2, Paperclip, FileText, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AttachContentProps {
  // Estado de upload/DOI
  uploadState: 'idle' | 'uploading' | 'error';
  doiInput: string;
  doiState: 'idle' | 'loading' | 'error';
  isDropZoneActive: boolean;

  // Handlers — drop zone
  onDropZoneDragOver: (e: React.DragEvent) => void;
  onDropZoneDragLeave: () => void;
  onDropZoneDrop: (e: React.DragEvent) => void;
  onDropZoneClick: () => void;

  // Handlers — DOI
  onDoiChange: (val: string) => void;
  onDoiSubmit: () => void;

  /** 'compact' = Popover (p-5, ícones menores) | 'full' = Dialog (p-8, ícones maiores) */
  variant?: 'compact' | 'full';
}

export function AttachContent({
  uploadState,
  doiInput,
  doiState,
  isDropZoneActive,
  onDropZoneDragOver,
  onDropZoneDragLeave,
  onDropZoneDrop,
  onDropZoneClick,
  onDoiChange,
  onDoiSubmit,
  variant = 'compact',
}: AttachContentProps) {
  const isCompact = variant === 'compact';

  return (
    <>
      {/* ── Drop zone ── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDropZoneDragOver(e);
        }}
        onDragLeave={() => onDropZoneDragLeave()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDropZoneDrop(e);
        }}
        onClick={onDropZoneClick}
        className={`cursor-pointer rounded-xl border-2 border-dashed text-center transition-all duration-200 ${
          isCompact ? 'p-5' : 'p-8'
        } ${
          isDropZoneActive
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border hover:border-primary/50 hover:bg-muted/50'
        }`}
      >
        {uploadState === 'uploading' ? (
          <>
            <Loader2
              className={`text-primary mx-auto mb-2 animate-spin ${isCompact ? 'h-6 w-6' : 'mb-3 h-8 w-8'}`}
            />
            <p className={`text-primary font-medium ${isCompact ? 'text-xs' : 'text-sm'}`}>
              {isCompact ? 'Processando PDF…' : 'Extraindo conteúdo…'}
            </p>
          </>
        ) : isDropZoneActive ? (
          <>
            <FileText
              className={`text-primary mx-auto mb-2 ${isCompact ? 'h-6 w-6' : 'mb-3 h-8 w-8'}`}
            />
            <p className={`text-primary font-semibold ${isCompact ? 'text-xs' : 'text-sm'}`}>
              Solte para anexar
            </p>
          </>
        ) : (
          <>
            {isCompact ? (
              <div className="group">
                <div className="bg-muted group-hover:bg-primary/10 mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg transition-colors">
                  <Paperclip className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
                </div>
                <p className="text-xs font-medium">Arraste um PDF aqui</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  ou clique para selecionar
                </p>
              </div>
            ) : (
              <>
                <Paperclip className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
                <p className="text-sm font-medium">Arraste um PDF ou clique para selecionar</p>
                <p className="text-muted-foreground mt-1 text-xs">Apenas arquivos .pdf</p>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Separador "ou via DOI" ── */}
      <div className="relative my-3 flex items-center gap-2">
        <div className="flex-1 border-t" />
        <span className={`text-muted-foreground ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
          ou via DOI
        </span>
        <div className="flex-1 border-t" />
      </div>

      {/* ── Campo DOI ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Hash
            className={`text-muted-foreground absolute top-1/2 -translate-y-1/2 ${
              isCompact ? 'left-2.5 h-3.5 w-3.5' : 'left-3 h-4 w-4'
            }`}
          />
          <Input
            value={doiInput}
            onChange={(e) => onDoiChange(e.target.value)}
            placeholder="10.1234/exemplo.2024"
            className={`font-mono ${isCompact ? 'pl-8 text-xs' : 'pl-9 text-sm'}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onDoiSubmit();
            }}
            disabled={doiState === 'loading'}
          />
        </div>
        <Button
          onClick={onDoiSubmit}
          disabled={doiState === 'loading' || !doiInput.trim()}
          size={isCompact ? 'sm' : 'default'}
          className="shrink-0"
        >
          {doiState === 'loading' ? (
            <Loader2 className={`animate-spin ${isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
          ) : (
            'Adicionar'
          )}
        </Button>
      </div>
    </>
  );
}

'use client';

/**
 * hooks/useAttachments.ts
 *
 * Centraliza toda a lógica de anexação de ficheiros ao acervo:
 * - Upload de PDF via /api/upload-pdf
 * - Adição por DOI via /api/add-by-doi
 * - Drag & drop (page-level)
 * - Estado dos chips de anexo visíveis no input
 * - Estado dos dialogs/popover de anexo
 */

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AttachmentChip {
  id: string;
  name: string;
  state: 'uploading' | 'done' | 'error';
  type: 'pdf' | 'doi';
}

interface UseAttachmentsOptions {
  chatId: string;
  addWatchedQueryId: (id: string) => void;
  refreshArticles: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAttachments({
  chatId,
  addWatchedQueryId,
  refreshArticles,
}: UseAttachmentsOptions) {
  // ── Chips visíveis sobre o input ─────────────────────────────────────────
  const [attachmentChips, setAttachmentChips] = useState<AttachmentChip[]>([]);

  // ── Estado do upload de PDF ──────────────────────────────────────────────
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Estado do DOI ────────────────────────────────────────────────────────
  const [doiInput, setDoiInput] = useState('');
  const [doiState, setDoiState] = useState<'idle' | 'loading' | 'error'>('idle');

  // ── Estado dos dialogs/popover ───────────────────────────────────────────
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  const [showAttachPopover, setShowAttachPopover] = useState(false);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);

  // ── Drag & drop page-level ───────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);

  // ── Helpers de limpeza de dialog/popover ────────────────────────────────
  const closeAttachPopover = useCallback(() => {
    setShowAttachPopover(false);
    setDoiInput('');
    setDoiState('idle');
    setIsDropZoneActive(false);
  }, []);

  const closeAttachDialog = useCallback(() => {
    setShowAttachDialog(false);
    setDoiInput('');
    setDoiState('idle');
    setIsDropZoneActive(false);
  }, []);

  // ── PDF Upload ───────────────────────────────────────────────────────────

  const submitPdfFile = useCallback(
    async (file: File) => {
      if (file.type !== 'application/pdf') {
        toast.error('Apenas arquivos PDF são suportados.');
        return;
      }
      const chipId = crypto.randomUUID();
      setAttachmentChips((prev) => [
        ...prev,
        { id: chipId, name: file.name, state: 'uploading', type: 'pdf' },
      ]);
      setUploadState('uploading');
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('chatId', chatId);
        const response = await fetch('/api/upload-pdf', { method: 'POST', body: formData });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }
        const data = (await response.json()) as { queryId?: string; title?: string };
        if (data.queryId) addWatchedQueryId(data.queryId);
        await refreshArticles();
        setUploadState('idle');
        setShowAttachDialog(false);
        setAttachmentChips((prev) =>
          prev.map((c) => (c.id === chipId ? { ...c, state: 'done' } : c))
        );
      } catch (err) {
        setUploadState('error');
        setAttachmentChips((prev) =>
          prev.map((c) => (c.id === chipId ? { ...c, state: 'error' } : c))
        );
        toast.error(`Falha no upload: ${(err as Error).message}`, { duration: 4000 });
        setTimeout(() => setUploadState('idle'), 4000);
      }
    },
    [chatId, addWatchedQueryId, refreshArticles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      files.forEach((f) => submitPdfFile(f));
      setShowAttachPopover(false);
    },
    [submitPdfFile]
  );

  // ── DOI ──────────────────────────────────────────────────────────────────

  const handleDoiSubmit = useCallback(async () => {
    const raw = doiInput.trim();
    const doi = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
    if (!doi || !chatId || doiState === 'loading') return;
    setDoiState('loading');
    const doiChipId = crypto.randomUUID();
    setAttachmentChips((prev) => [
      ...prev,
      { id: doiChipId, name: doi, state: 'uploading', type: 'doi' },
    ]);
    setShowAttachPopover(false);
    try {
      const response = await fetch('/api/add-by-doi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doi, chatId }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as { title?: string; queryId?: string };
      if (data.queryId) addWatchedQueryId(data.queryId);
      await refreshArticles();
      setDoiState('idle');
      setDoiInput('');
      setShowAttachDialog(false);
      setAttachmentChips((prev) =>
        prev.map((c) => (c.id === doiChipId ? { ...c, state: 'done', name: data.title ?? doi } : c))
      );
      toast.success(data.title ? `"${data.title}" adicionado!` : 'Artigo adicionado ao acervo!', {
        duration: 3000,
      });
    } catch (err) {
      setDoiState('error');
      setAttachmentChips((prev) =>
        prev.map((c) => (c.id === doiChipId ? { ...c, state: 'error' } : c))
      );
      toast.error(`DOI inválido ou não encontrado: ${(err as Error).message}`, {
        duration: 4000,
      });
      setTimeout(() => setDoiState('idle'), 4000);
    }
  }, [doiInput, doiState, chatId, addWatchedQueryId, refreshArticles]);

  // ── Drag & Drop (page-level) ─────────────────────────────────────────────

  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }, []);

  const handlePageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      Array.from(e.dataTransfer.files)
        .filter((f) => f.type === 'application/pdf')
        .forEach((f) => submitPdfFile(f));
    },
    [submitPdfFile]
  );

  // ── Helpers adicionais ──────────────────────────────────────────────────
  const removeChip = useCallback((id: string) => {
    setAttachmentChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearChips = useCallback(() => {
    setAttachmentChips([]);
  }, []);

  return {
    // chips — nomes canônicos
    attachmentChips,
    setAttachmentChips,
    // chips — aliases curtos usados pelos componentes filhos
    chips: attachmentChips,
    removeChip,
    clearChips,
    // PDF
    uploadState,
    fileInputRef,
    submitPdfFile,
    handleFileInputChange,
    handleFileSelect: handleFileInputChange, // alias
    // DOI
    doiInput,
    setDoiInput,
    doiState,
    handleDoiSubmit,
    // drag & drop
    isDragging,
    handlePageDragOver,
    handlePageDragLeave,
    handlePageDrop,
    // dialog/popover
    showAttachDialog,
    setShowAttachDialog,
    isAttachDialogOpen: showAttachDialog, // alias
    setIsAttachDialogOpen: setShowAttachDialog, // alias
    showAttachPopover,
    setShowAttachPopover,
    isDropZoneActive,
    setIsDropZoneActive,
    closeAttachPopover,
    closeAttachDialog,
  };
}

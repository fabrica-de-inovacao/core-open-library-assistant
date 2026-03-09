'use client';

/**
 * components/workspace/WorkspaceHeader.tsx
 *
 * Faixa superior fixa do workspace (h-14).
 * Modo home: seletor de modelo.
 * Modo chat: título da sessão + badge de artigos + share.
 */

import { useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Cpu,
  ExternalLink,
  Loader2,
  MessagesSquare,
  Share2,
} from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MODEL_OPTIONS, type ModelValue } from '@/hooks/useSearchSettings';

interface WorkspaceHeaderProps {
  hasActiveSession: boolean;
  // Home mode
  modelId: ModelValue;
  onModelChange: (m: ModelValue) => void;
  // Chat mode
  sessionTitle?: string;
  articleCount?: number;
  isSearchRunning?: boolean;
  chatId: string;
}

export function WorkspaceHeader({
  hasActiveSession,
  modelId,
  onModelChange,
  sessionTitle,
  articleCount = 0,
  isSearchRunning = false,
  chatId,
}: WorkspaceHeaderProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/share/chat/${chatId}`
      : `/share/chat/${chatId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement('input');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const whatsappText = [
    sessionTitle ? `📚 *${sessionTitle}*` : `📚 *Revisão sistemática gerada com C.O.R.E.*`,
    ``,
    `Usei a C.O.R.E. AI para fazer uma busca acadêmica automatizada e montar essa revisão — com artigos de bases como ACM, IEEE e Springer.`,
    ``,
    `Veja o resultado completo aqui:`,
    shareUrl,
    ``,
    `_C.O.R.E. AI — pesquisa acadêmica com IA_`,
  ].join('\n');

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;
  return (
    <header className="bg-background/95 border-border/60 flex h-14 shrink-0 items-center justify-between border-b px-4 backdrop-blur-sm">
      {/* ── Lado esquerdo ── */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {/* Trigger visível apenas em mobile */}
        <SidebarTrigger className="text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded-md transition-colors md:hidden" />

        {hasActiveSession ? (
          /* Título da sessão ativa */
          <>
            <MessagesSquare className="text-muted-foreground/40 hidden h-3.5 w-3.5 shrink-0 sm:block" />
            <span
              className="text-foreground/80 min-w-0 truncate text-[13px] font-medium tracking-tight"
              title={sessionTitle ?? 'Sessão sem título'}
            >
              {sessionTitle ?? <span className="text-muted-foreground/40">Sessão sem título</span>}
            </span>
          </>
        ) : (
          /* Home: sem label */
          <span className="text-muted-foreground/40 text-sm font-medium tracking-tight" />
        )}
      </div>

      {/* ── Lado direito ── */}
      <div className="flex shrink-0 items-center gap-2">
        {hasActiveSession ? (
          /* ── Ações do modo chat ── */
          <>
            {/* Indicador de busca em andamento */}
            {isSearchRunning && (
              <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="hidden sm:inline">Buscando…</span>
              </div>
            )}

            {/* Badge de artigos encontrados */}
            {articleCount > 0 && (
              <div className="border-border/40 bg-muted/30 text-muted-foreground flex items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums select-none">
                <BookOpen className="h-3 w-3 shrink-0" />
                <span>
                  {articleCount} {articleCount === 1 ? 'artigo' : 'artigos'}
                </span>
              </div>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <button className="border-border/50 bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors">
                  <Share2 className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline">Compartilhar</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">
                <p className="text-muted-foreground px-2 pt-1 pb-2 text-[11px]">
                  Qualquer pessoa com o link pode visualizar esta sessão sem login.
                </p>
                <div className="flex flex-col gap-0.5">
                  {/* Copiar link */}
                  <button
                    onClick={handleCopy}
                    className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors"
                  >
                    {copied ? (
                      <Check className="text-primary h-4 w-4 shrink-0" />
                    ) : (
                      <Copy className="text-muted-foreground h-4 w-4 shrink-0" />
                    )}
                    <span className={copied ? 'text-primary font-medium' : ''}>
                      {copied ? 'Link copiado!' : 'Copiar link'}
                    </span>
                  </button>

                  {/* Abrir em nova aba */}
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
                  >
                    <ExternalLink className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span>Abrir prévia</span>
                  </a>

                  <div className="bg-border/40 my-1 h-px" />

                  {/* WhatsApp */}
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
                  >
                    {/* Ícone SVG do WhatsApp */}
                    <svg
                      className="h-4 w-4 shrink-0 text-[#25D366]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    <span>Compartilhar via WhatsApp</span>
                  </a>
                </div>
              </PopoverContent>
            </Popover>
          </>
        ) : (
          /* ── Seletor de modelo (apenas home) ── */
          <div className="flex items-center gap-1.5">
            <Cpu className="text-muted-foreground h-3.5 w-3.5" />
            <Select value={modelId} onValueChange={(val) => onModelChange(val as ModelValue)}>
              <SelectTrigger className="h-7 w-[160px] text-xs">
                <SelectValue placeholder="Modelo" />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-muted-foreground ml-1">— {m.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </header>
  );
}

'use client';

/**
 * components/workspace/InputToolbar.tsx
 *
 * Toolbar inferior compartilhada entre ChatInputBar e HomeView.
 * Contém: popover de modelo · indicador de cobertura · pill de síntese · pill de limite.
 *
 * Slots:
 *  - leftSlot  — renderizado antes do modelo (ex: botão Anexar no HomeView)
 *  - rightSlot — renderizado após o pill de limite (ex: botão Enviar no HomeView)
 */

import { Globe, Cpu, ChevronDown, Check, Wand2, Sparkles, BookOpen } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SynthesisMode } from '@/hooks/useChatOrchestration';
import { MODEL_OPTIONS, type ModelValue } from '@/hooks/useSearchSettings';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface InputToolbarProps {
  // Modelo de IA
  modelId?: ModelValue;
  onModelChange?: (m: ModelValue) => void;

  // Fase C (IA-04): modo de síntese
  synthesisMode?: SynthesisMode;
  onSynthesisModeChange?: (m: SynthesisMode) => void;

  // Limite de artigos
  searchLimit: 10 | 25;
  onSearchLimitChange: (v: 10 | 25) => void;

  /**
   * Conteúdo injetado antes do popover de modelo.
   * Usado pelo HomeView para o botão/popover de Anexar.
   */
  leftSlot?: React.ReactNode;

  /**
   * Conteúdo injetado após o pill de limite.
   * Usado pelo HomeView para o botão Enviar.
   */
  rightSlot?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

const SYNTHESIS_OPTIONS: {
  value: SynthesisMode;
  icon: React.ReactNode;
  label: string;
  tooltip: string;
}[] = [
  {
    value: 'auto',
    icon: <Wand2 className="h-2.5 w-2.5" />,
    label: 'Auto',
    tooltip: 'RouterAgent decide o modo automaticamente',
  },
  {
    value: 'quick',
    icon: <Sparkles className="h-2.5 w-2.5" />,
    label: 'Rápida',
    tooltip: 'Síntese concisa — 2-3 parágrafos',
  },
  {
    value: 'systematic',
    icon: <BookOpen className="h-2.5 w-2.5" />,
    label: 'Sistemática',
    tooltip: 'Revisão sistemática completa com tabela e gaps',
  },
];

export function InputToolbar({
  modelId,
  onModelChange,
  synthesisMode = 'auto',
  onSynthesisModeChange,
  searchLimit,
  onSearchLimitChange,
  leftSlot,
  rightSlot,
}: InputToolbarProps) {
  return (
    <div className="border-border/40 flex items-center gap-1.5 border-t px-3 py-1.5">
      {/* Slot esquerdo (ex: botão Anexar no HomeView) — separador responsabilidade do slot */}
      {leftSlot}

      {/* Popover de modelo */}
      {modelId && onModelChange && (
        <>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors"
                  >
                    <Cpu className="h-3 w-3 shrink-0" />
                    <span className="text-[10px] leading-none font-medium">
                      {MODEL_OPTIONS.find((m) => m.value === modelId)?.label ?? modelId}
                    </span>
                    <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8} className="text-xs">
                Modelo de IA
              </TooltipContent>
            </Tooltip>
            <PopoverContent side="top" align="start" sideOffset={8} className="w-64 p-1">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => onModelChange(m.value)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                    modelId === m.value ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                  }`}
                >
                  <Check
                    className={`h-3 w-3 shrink-0 ${
                      modelId === m.value ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <span className="font-medium">{m.label}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">{m.description}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <div className="bg-border/40 h-3 w-px shrink-0" />
        </>
      )}

      {/* Indicador de cobertura — só ícone para economizar espaço */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Globe className="text-muted-foreground/40 h-3 w-3 shrink-0 cursor-default" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="text-xs">
          Cobertura: C.O.R.E. · ACM · IEEE · Springer
        </TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {/* Pill de modo de síntese */}
      {onSynthesisModeChange && (
        <>
          <div className="border-border/30 bg-muted/40 flex items-center rounded-lg border p-0.5">
            {SYNTHESIS_OPTIONS.map(({ value, icon, label, tooltip }) => (
              <Tooltip key={value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSynthesisModeChange(value)}
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
                      synthesisMode === value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {icon}
                    {label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} className="text-xs">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="bg-border/40 h-3 w-px shrink-0" />
        </>
      )}

      {/* Pill de limite de artigos */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="border-border/30 bg-muted/40 flex items-center rounded-lg border p-0.5">
            {([10, 25] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onSearchLimitChange(v)}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
                  searchLimit === v
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="text-xs">
          Máximo de artigos por busca
        </TooltipContent>
      </Tooltip>

      {/* Slot direito (ex: botão Enviar no HomeView) — separador responsabilidade do slot */}
      {rightSlot}
    </div>
  );
}

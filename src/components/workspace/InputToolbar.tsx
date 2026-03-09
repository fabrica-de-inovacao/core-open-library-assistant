'use client';

/**
 * components/workspace/InputToolbar.tsx
 *
 * Toolbar inferior compartilhada entre ChatInputBar e HomeView.
 * Contém: popover de modelo · indicador de cobertura · seletor de modo de análise.
 *
 * Modos de análise (FEAT-02):
 *   🤖 Auto      → RouterAgent decide (límite e síntese adaptativos)
 *   ⚡ Rápida    → 10 artigos + resumo conciso
 *   🔍 Estendida → 20 artigos + revisão sistemática completa
 */

import { Globe, Cpu, ChevronDown, Check, Wand2, Zap, BookOpen } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MODEL_OPTIONS, type ModelValue, type AnalysisMode } from '@/hooks/useSearchSettings';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface InputToolbarProps {
  // Modelo de IA
  modelId?: ModelValue;
  onModelChange?: (m: ModelValue) => void;

  // Modo de análise unificado (substitui synthesisMode + searchLimit separados)
  analysisMode?: AnalysisMode;
  onAnalysisModeChange?: (m: AnalysisMode) => void;

  /**
   * Conteúdo injetado antes do popover de modelo.
   * Usado pelo HomeView para o botão/popover de Anexar.
   */
  leftSlot?: React.ReactNode;

  /**
   * Conteúdo injetado após o pill de modo.
   * Usado pelo HomeView para o botão Enviar.
   */
  rightSlot?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Configuração dos modos de análise
// ---------------------------------------------------------------------------

const ANALYSIS_OPTIONS: {
  value: AnalysisMode;
  icon: React.ReactNode;
  label: string;
  description: string;
  badge: string;
}[] = [
  {
    value: 'auto',
    icon: <Wand2 className="h-2.5 w-2.5" />,
    label: 'Auto',
    description: 'IA escolhe o modo ideal para a consulta',
    badge: 'IA decide',
  },
  {
    value: 'quick',
    icon: <Zap className="h-2.5 w-2.5" />,
    label: 'Rápida',
    description: 'Até 10 artigos · resumo conciso · ~1-2 min',
    badge: '10 artigos',
  },
  {
    value: 'extended',
    icon: <BookOpen className="h-2.5 w-2.5" />,
    label: 'Estendida',
    description: 'Até 20 artigos · revisão sistemática · ~5-8 min',
    badge: '20 artigos',
  },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function InputToolbar({
  modelId,
  onModelChange,
  analysisMode = 'auto',
  onAnalysisModeChange,
  leftSlot,
  rightSlot,
}: InputToolbarProps) {
  const currentMode = ANALYSIS_OPTIONS.find((o) => o.value === analysisMode) ?? ANALYSIS_OPTIONS[0];

  return (
    <div className="border-border/40 flex items-center gap-1.5 border-t px-3 py-1.5">
      {/* Slot esquerdo (ex: botão Anexar no HomeView) */}
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

      {/* Seletor de modo de análise (FEAT-02) */}
      {onAnalysisModeChange && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="border-border/30 bg-muted/40 hover:bg-muted/70 flex items-center gap-1.5 rounded-lg border px-2 py-0.5 transition-colors"
                >
                  <span className="text-muted-foreground">{currentMode.icon}</span>
                  <span className="text-[10px] font-medium">{currentMode.label}</span>
                  <ChevronDown className="text-muted-foreground h-2.5 w-2.5 opacity-50" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="text-xs">
              Modo de análise · {currentMode.badge}
            </TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="end" sideOffset={8} className="w-72 p-1.5">
            <p className="text-muted-foreground mb-1.5 px-1.5 text-[10px] font-semibold tracking-wider uppercase">
              Modo de análise
            </p>
            {ANALYSIS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onAnalysisModeChange(opt.value)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  analysisMode === opt.value
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60'
                }`}
              >
                <span className="mt-0.5 shrink-0">{opt.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold">{opt.label}</span>
                    <span className="text-muted-foreground bg-muted rounded px-1 py-0.5 text-[9px] font-medium">
                      {opt.badge}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                    {opt.description}
                  </p>
                </div>
                {analysisMode === opt.value && (
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {/* Slot direito (ex: botão Enviar no HomeView) */}
      {rightSlot}
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState, useId } from 'react';
import mermaid from 'mermaid';
import { Download, Copy, Check, FileCode, Workflow, Maximize2, X } from 'lucide-react';
import { toast } from 'sonner';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
});

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// ---------------------------------------------------------------------------
// AssetWrapper: Embalagem unificada para assets visuais
// ---------------------------------------------------------------------------
export const AssetWrapper = ({
  title,
  icon,
  children,
  onCopy,
  onDownload,
  downloadLabel = 'Baixar',
  contentClassName = '',
  allowFullscreen = true,
  previewZoom = 0.68,
  previewFull = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onCopy?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  contentClassName?: string;
  allowFullscreen?: boolean;
  /** Zoom CSS aplicado ao preview no chat. Padrão 0.68. Passe 1 para exibir em tamanho real. */
  previewZoom?: number;
  /** Exibe o conteúdo completo no preview (sem corte). Ideal para tabelas. */
  previewFull?: boolean;
}) => {
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Reset zoom ao fechar
  const handleClose = () => {
    setIsFullscreen(false);
    setZoom(1);
  };

  const zoomIn = () => setZoom((z) => Math.min(parseFloat((z + 0.25).toFixed(2)), 3));
  const zoomOut = () => setZoom((z) => Math.max(parseFloat((z - 0.25).toFixed(2)), 0.5));
  const zoomReset = () => setZoom(1);

  // Ref para a área de conteúdo do fullscreen (gestos)
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll do mouse com Ctrl/Cmd → zoom
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !isFullscreen) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => {
        const next = e.deltaY < 0 ? z + 0.1 : z - 0.1;
        return Math.min(3, Math.max(0.5, parseFloat(next.toFixed(2))));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isFullscreen]);

  // Pinch (dois dedos) → zoom
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !isFullscreen) return;
    let lastDist: number | null = null;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) lastDist = dist(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastDist === null) return;
      e.preventDefault();
      const d = dist(e.touches);
      const ratio = d / lastDist;
      lastDist = d;
      setZoom((z) => Math.min(3, Math.max(0.5, parseFloat((z * ratio).toFixed(2)))));
    };
    const onEnd = () => {
      lastDist = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [isFullscreen]);

  const handleCopy = () => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      toast.success('Copiado!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div className="animate-in fade-in slide-in-from-bottom-2 border-border/50 bg-card text-card-foreground my-4 overflow-hidden rounded-lg border shadow-sm duration-300">
        {/* Header */}
        <div className="border-border/50 bg-muted/40 flex items-center justify-between border-b px-3 py-2">
          <div className="text-foreground/80 flex items-center gap-2 text-[12px] font-semibold">
            {icon}
            {title}
          </div>
          <div className="flex items-center gap-1">
            {onCopy && (
              <button
                onClick={handleCopy}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                title="Copiar conteúdo bruto"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span className="sr-only">Copiar</span>
              </button>
            )}
            {onDownload && (
              <button
                onClick={onDownload}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                title={downloadLabel}
              >
                <Download className="h-3 w-3" />
                <span className="sr-only">Baixar</span>
              </button>
            )}
            {allowFullscreen && (
              <button
                onClick={() => setIsFullscreen(true)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                title="Expandir"
              >
                <Maximize2 className="h-3 w-3" />
                <span className="sr-only">Expandir</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Preview */}
        <div
          className={`relative ${previewFull ? 'overflow-auto' : 'max-h-52 overflow-auto'} ${contentClassName}`}
        >
          <div style={previewZoom !== 1 ? { zoom: previewZoom } : undefined}>{children}</div>
          {/* Fade-out na base — apenas quando há corte */}
          {!previewFull && (
            <div className="from-card pointer-events-none absolute right-0 bottom-0 left-0 h-8 bg-linear-to-t to-transparent" />
          )}
        </div>
      </div>

      <Dialog
        open={isFullscreen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[90vh] max-h-[90vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden border-0 p-0 shadow-xl sm:max-w-5xl"
        >
          <DialogTitle className="sr-only">Visualização Expandida: {title}</DialogTitle>

          {/* Header */}
          <div className="border-border/50 bg-muted/40 flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <div className="text-foreground/80 flex items-center gap-2 text-[13px] font-semibold">
              {icon}
              {title}
            </div>
            <div className="flex items-center gap-1">
              {onDownload && (
                <button
                  onClick={onDownload}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
                  title={downloadLabel}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{downloadLabel}</span>
                </button>
              )}
              {onDownload && <div className="bg-border mx-1 h-4 w-px" />}
              <button
                onClick={handleClose}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors"
                title="Fechar (Esc)"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Fechar</span>
              </button>
            </div>
          </div>

          {/* Content — gestos de zoom via wheel+pinch, botões flutuantes */}
          <div
            ref={contentRef}
            className="relative min-h-0 flex-1 overflow-auto p-6 [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full!"
          >
            <div
              style={{ width: `${zoom * 100}%`, minWidth: zoom < 1 ? `${zoom * 100}%` : undefined }}
              className="mx-auto transition-[width] duration-150"
            >
              {children}
            </div>

            {/* Controles de zoom flutuantes — sticky na base da área visível */}
            <div className="pointer-events-none sticky right-0 bottom-4 left-0 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-black/60 px-2 py-1.5 shadow-xl backdrop-blur-md">
                <button
                  onClick={zoomOut}
                  disabled={zoom <= 0.5}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                  title="Zoom out (Ctrl+scroll)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                </button>
                <button
                  onClick={zoomReset}
                  className="min-w-11 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-white/80 tabular-nums transition-colors hover:bg-white/10 hover:text-white"
                  title="Resetar zoom"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  disabled={zoom >= 3}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                  title="Zoom in (Ctrl+scroll)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ---------------------------------------------------------------------------
// MermaidBlock: Renderiza diagramas gerados pelo LLM e exporta como SVG
// ---------------------------------------------------------------------------
export const MermaidBlock = ({ code }: { code: string }) => {
  const [svg, setSvg] = useState<string>('');
  const [errorInfo, setErrorInfo] = useState<{ msg: string; finalCode: string } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const reactId = useId();
  // Clean id for mermaid (remove colons)
  const id = `mermaid-${reactId.replace(/:/g, '')}`;

  useEffect(() => {
    const renderDiagram = async () => {
      console.group('[MermaidBlock] Iniciando renderização');
      console.log('[MermaidBlock] RAW code recebido:\n', JSON.stringify(code));

      try {
        let safeCode = code.replace(/\r\n/g, '\n').trim();

        // 1. Limpeza de blocos de markdown em torno do mermaid
        if (safeCode.startsWith('```mermaid')) {
          safeCode = safeCode.replace(/^```mermaid\s*/i, '');
        }
        if (safeCode.endsWith('```')) {
          safeCode = safeCode.replace(/```$/, '');
        }
        safeCode = safeCode.trim();
        console.log('[MermaidBlock] Após remover fences:\n', safeCode);

        // 2. Prevenir falha de "mesma linha" comum (ex: "graph TD A(Início)")
        // Nota: 'pie' excluído propositalmente — sua sintaxe é 'pie title Texto', onde
        // 'title' faz parte da diretiva, não é um ID de direção.
        // IMPORTANTE: usa [ \t]+ (espaço horizontal) e NÃO \s+ para evitar consumir
        // quebras de linha — \s+ incluiria \n e dispararia a correção em código
        // multi-linha correto, truncando o diagrama para apenas a primeira linha.
        if (
          safeCode.match(
            /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|gantt|erDiagram|journey)[ \t]+[a-zA-Z0-9_-]+[ \t]+/i
          )
        ) {
          // Extraímos a parte inicial (ex: graph TD) e depois o resto
          safeCode = safeCode.replace(
            /^((?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|gantt|erDiagram|journey)[ \t]+[^\s]+)[ \t]+(.+)/i,
            '$1\n$3'
          );
          console.log('[MermaidBlock] Após correção de mesma linha:\n', safeCode);
        }

        // 3. Normaliza sintaxe verbosa de xychart-beta gerada por LLMs.
        // O LLM às vezes gera blocos {type category / categories / data}
        // que NÃO existem na spec do xychart-beta — precisa ser reescrito
        // para a forma simples ANTES do processamento linha-a-linha.
        if (/^xychart-beta/i.test(safeCode)) {
          // x-axis "Label" { ... categories [...] ... }  →  x-axis "Label" [...]
          safeCode = safeCode.replace(
            /x-axis\s*"([^"]*)"\s*\{[^}]*?categories\s*(\[[^\]]*\])[^}]*\}/gis,
            'x-axis "$1" $2'
          );
          // x-axis { ... categories [...] ... }  →  x-axis [...]
          safeCode = safeCode.replace(
            /x-axis\s*\{[^}]*?categories\s*(\[[^\]]*\])[^}]*\}/gis,
            'x-axis $1'
          );
          // y-axis "Label" { ... min X ... max Y ... }  →  y-axis "Label" X --> Y
          safeCode = safeCode.replace(
            /y-axis\s*"([^"]*)"\s*\{[^}]*?min\s+(\d+(?:\.\d+)?)[^}]*?max\s+(\d+(?:\.\d+)?)[^}]*\}/gis,
            'y-axis "$1" $2 --> $3'
          );
          // y-axis { ... min X ... max Y ... }  →  y-axis X --> Y
          safeCode = safeCode.replace(
            /y-axis\s*\{[^}]*?min\s+(\d+(?:\.\d+)?)[^}]*?max\s+(\d+(?:\.\d+)?)[^}]*\}/gis,
            'y-axis $1 --> $2'
          );
          // bar-series "Label" { data [...] }  →  bar [...]
          safeCode = safeCode.replace(
            /bar-series\s*"[^"]*"\s*\{[^}]*?data\s*(\[[^\]]*\])[^}]*\}/gis,
            'bar $1'
          );
          // line-series "Label" { data [...] }  →  line [...]
          safeCode = safeCode.replace(
            /line-series\s*"[^"]*"\s*\{[^}]*?data\s*(\[[^\]]*\])[^}]*\}/gis,
            'line $1'
          );
        }

        // 4. Corrige strings mal formatadas como rótulos contendo aspas
        // Algumas respostas do LLM vêm com textos "algo" que quebram sem scape.
        // E IDs sem aspas ou espaços (Mermaid 11+ é estrito)
        const lines = safeCode.split('\n');
        const processedLines = lines.map((line) => {
          let l = line.trim();
          if (!l) return line;

          // Trata node default quebrado: id"Texto" -> id["Texto"]
          // ATENÇÃO: lookahead (?!\s*[\]\)\[]) — évita match em:
          //   - "Label" ["item1", ...] — sintaxe xychart-beta (seguido de \s*[)
          //   - "Label"] — fechamento de lista
          //   - "Label") — fechamento de parênteses
          l = l.replace(/([a-zA-Z0-9_-]+)"([^"]+)"(?!\s*[\]\)\[])/g, '$1["$2"]');

          // Parênteses () dentro de labels rhombus {} causam parse error no Mermaid
          // (o parser interpreta '(' como início de nó stadium).
          // Solução: envolver o inner em aspas duplas, que o Mermaid aceita.
          // Ex: E{Texto (algo)} → E{"Texto (algo)"}
          l = l.replace(/\{([^}"]*\([^}]*)\}/g, (_, inner) => `{"${inner.trim()}"}`);

          return l;
        });

        safeCode = processedLines.join('\n');
        console.log('[MermaidBlock] Código FINAL para render (id=%s):\n%s', id, safeCode);

        // 5. Valida sintaxe via parse() antes do render — expõe linha/coluna do erro
        try {
          await mermaid.parse(safeCode);
          console.log('[MermaidBlock] ✅ parse() OK');
        } catch (parseErr) {
          const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.warn('[MermaidBlock] ⚠️ parse() falhou (tentando render mesmo assim):', parseMsg);
        }

        const { svg: svgCode } = await mermaid.render(id, safeCode);
        console.log('[MermaidBlock] ✅ render() OK — SVG bytes:', svgCode.length);
        setSvg(svgCode);
        setErrorInfo(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MermaidBlock] ❌ render() falhou:', msg);
        console.error('[MermaidBlock] Código que causou erro (RAW):\n', code);
        setErrorInfo({ msg, finalCode: code });
        setSvg('');
      } finally {
        console.groupEnd();
      }
    };
    renderDiagram();
  }, [code, id]);

  const handleDownload = () => {
    if (!wrapperRef.current) return;
    const svgEl = wrapperRef.current.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagrama-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Diagrama baixado (SVG)');
  };

  return (
    <AssetWrapper
      title="Diagrama (Mermaid)"
      icon={<Workflow className="h-3.5 w-3.5" />}
      onCopy={() => navigator.clipboard.writeText(code)}
      onDownload={svg ? handleDownload : undefined}
      downloadLabel="Baixar SVG"
      contentClassName="p-4 bg-white dark:bg-zinc-950 flex justify-center"
    >
      {!svg && !errorInfo ? (
        <div className="text-muted-foreground flex animate-pulse justify-center p-8 text-sm">
          Renderizando diagrama...
        </div>
      ) : errorInfo ? (
        <div className="w-full space-y-2 p-4">
          <p className="text-sm font-semibold text-rose-500">
            ❌ Erro ao renderizar diagrama Mermaid
          </p>
          <p className="font-mono text-xs break-all text-rose-400">{errorInfo.msg}</p>
          <details className="mt-2">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              Ver código problemático
            </summary>
            <pre className="bg-muted mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap">
              {errorInfo.finalCode}
            </pre>
          </details>
        </div>
      ) : (
        <div ref={wrapperRef} className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </AssetWrapper>
  );
};

// ---------------------------------------------------------------------------
// CodeBlock: Wrap padrão para blocos de código
// ---------------------------------------------------------------------------
export const CodeBlock = ({ code, language }: { code: string; language?: string }) => {
  const handleDownload = () => {
    const ext = language || 'txt';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codigo-${Date.now()}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <AssetWrapper
      title={`Código ${language ? `(${language})` : ''}`}
      icon={<FileCode className="h-3.5 w-3.5" />}
      onCopy={() => navigator.clipboard.writeText(code)}
      onDownload={handleDownload}
      downloadLabel="Baixar Arquivo"
      contentClassName="bg-[#0d1117]"
    >
      <pre className="overflow-x-auto p-4 font-mono text-[13px] text-gray-300">
        <code>{code}</code>
      </pre>
    </AssetWrapper>
  );
};

'use client';

import React, { useEffect, useRef, useState, useId } from 'react';
import mermaid from 'mermaid';
import { Download, Copy, Check, FileCode, Workflow } from 'lucide-react';
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
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onCopy?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  contentClassName?: string;
  allowFullscreen?: boolean;
}) => {
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      <div className="border-border/50 bg-card text-card-foreground group my-4 overflow-hidden rounded-lg border shadow-sm">
        {/* Header */}
        <div
          className="border-border/50 bg-muted/40 flex cursor-pointer items-center justify-between border-b px-3 py-2"
          onClick={() => allowFullscreen && setIsFullscreen(true)}
        >
          <div className="text-foreground/80 flex items-center gap-2 text-[12px] font-semibold">
            {icon}
            {title}
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>

        {/* Content Preview */}
        <div
          className={`relative max-h-[60vh] overflow-auto ${contentClassName} ${allowFullscreen ? 'cursor-zoom-in' : ''}`}
          onClick={() => allowFullscreen && setIsFullscreen(true)}
          title={allowFullscreen ? 'Clique para expandir' : undefined}
        >
          {children}
          {allowFullscreen && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/5 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="bg-background/80 text-foreground flex items-center gap-1 rounded px-2 py-1 text-xs shadow-sm backdrop-blur-sm">
                Clique para expandir
              </span>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent className="border-border/50 flex max-h-[95vh] w-fit max-w-[95vw] flex-col items-center overflow-auto bg-white p-6 dark:bg-zinc-950">
          <DialogTitle className="sr-only">Visualização Expandida: {title}</DialogTitle>
          <div className="border-border/30 mb-4 flex w-full items-center justify-between border-b pb-2">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              {icon} {title}
            </h3>
            <div className="flex gap-2">
              {onDownload && (
                <button
                  onClick={onDownload}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {downloadLabel}
                </button>
              )}
            </div>
          </div>
          <div className="flex min-h-[50vh] w-full justify-center rounded bg-white p-4 dark:bg-zinc-950">
            {children}
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  const reactId = useId();
  // Clean id for mermaid (remove colons)
  const id = `mermaid-${reactId.replace(/:/g, '')}`;

  useEffect(() => {
    const renderDiagram = async () => {
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

        // 2. Prevenir falha de "mesma linha" comum (ex: "graph TD A(Início)")
        // Se a primeira linha não for a única, mas tiver conteúdo pós-declaração, quebre-a
        // Isso resolve o erro "Got 'text' instead of space..."
        if (
          safeCode.match(
            /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|gantt|pie|erDiagram|journey)\s+[a-zA-Z0-9_-]+\s+/i
          )
        ) {
          // Extraímos a parte inicial (ex: graph TD) e depois o resto
          safeCode = safeCode.replace(
            /^((?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|gantt|pie|erDiagram|journey)\s+[^\s]+)\s+(.+)/i,
            '$1\n$3'
          );
        }

        // 3. Corrige strings mal formatadas como rótulos contendo aspas
        // Algumas respostas do LLM vêm com textos "algo" que quebram sem scape.
        // E IDs sem aspas ou espaços (Mermaid 11+ é estrito)
        const lines = safeCode.split('\n');
        const processedLines = lines.map((line) => {
          let l = line.trim();
          if (!l) return line;

          // Trata node default quebrado: id"Texto" -> id["Texto"]
          l = l.replace(/([a-zA-Z0-9_-]+)"([^"]+)"(?!\s*\]|\s*\))/g, '$1["$2"]');

          return l;
        });

        safeCode = processedLines.join('\n');

        const { svg: svgCode } = await mermaid.render(id, safeCode);
        setSvg(svgCode);
      } catch (err) {
        console.error('Mermaid render error', err);
        setSvg(
          '<div class="text-rose-500 p-4 font-mono text-sm">Erro ao renderizar diagrama Mermaid. Verifique a sintaxe.</div>'
        );
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
      onDownload={svg && !svg.includes('Erro ao renderizar') ? handleDownload : undefined}
      downloadLabel="Baixar SVG"
      contentClassName="p-4 bg-white dark:bg-zinc-950 flex justify-center"
    >
      {!svg ? (
        <div className="text-muted-foreground flex animate-pulse justify-center p-8 text-sm">
          Renderizando diagrama...
        </div>
      ) : (
        <div ref={wrapperRef} dangerouslySetInnerHTML={{ __html: svg }} />
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

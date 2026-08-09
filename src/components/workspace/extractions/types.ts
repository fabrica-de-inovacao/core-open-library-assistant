import type { RealtimeStatus } from '@/hooks/useArticleStream';

// ---------------------------------------------------------------------------
// View-model para artigos exibidos no painel de extração.
// Subconjunto do esquema DB — apenas os campos necessários para renderização.
// ---------------------------------------------------------------------------
export interface Article {
  id: string;
  title?: string | null;
  authors?: string | null;
  publicationYear?: number | null;
  sourceName?: string | null;
  doi?: string | null;
  citationCount?: number | null;
  keywords?: string | null;
  abstract?: string | null;
  tldrContent?: string | null;
  originalUrl?: string | null;
  status?: string | null;
  publisher?: string | null;
  isOpenAccess?: boolean | null;
  // Fase 3 (P-PDF): identifica documentos enviados pelo próprio usuário
  metadataSource?: string | null;
  // Fase 6 (P-seguinte): grafo de citações via Semantic Scholar
  // Tipado como unknown para compatibilidade com o jsonb inferência do Drizzle;
  // cast para CitationGraphData é feito no ArticleCard.
  citationGraph?: unknown | null;
}

export interface ArticleCardProps {
  article: Article;
  index: number;
  isSelected: boolean;
  isHighlighted: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  /** Remove o artigo do acervo (apenas documentos do próprio utilizador) */
  onDeleteArticle?: (id: string) => Promise<void>;
}

export interface ExtractionsPanelProps {
  articles: Article[];
  activeQueryId: string | null;
  /** G-03: highlightedRow usa UUID (string) em vez de número de linha */
  highlightedRow: string | null;
  hasZeroResults: boolean;
  isSearchRunning: boolean;
  realtimeStatus: RealtimeStatus;
  /** Callback para recolher o painel direito */
  onCollapse?: () => void;
  /** Remove o artigo do acervo (apenas documentos do próprio utilizador) */
  onDeleteArticle?: (id: string) => Promise<void>;
  /** Cancela a extração em andamento */
  onCancelSearch?: (qId: string) => Promise<void>;
  title?: string;
  searchCount?: number;
}

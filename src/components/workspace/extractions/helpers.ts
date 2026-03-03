import { toast } from 'sonner';
import type { Article } from './types';

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------
export async function copyToClipboard(text: string, label = 'Copiado!') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const inp = document.createElement('input');
    inp.value = text;
    document.body.appendChild(inp);
    inp.select();
    document.execCommand('copy');
    document.body.removeChild(inp);
  }
  toast.success(label, { duration: 1800 });
}

// ---------------------------------------------------------------------------
// Citation generators
// ---------------------------------------------------------------------------
export function buildCitationApa(
  article: Pick<Article, 'authors' | 'publicationYear' | 'title' | 'sourceName'>
): string {
  const year = article.publicationYear ? ` (${article.publicationYear})` : '';
  return `${article.authors || 'Unknown'}.${year}. ${article.title}. ${article.sourceName || ''}.`;
}

export function buildCitationAbnt(
  article: Pick<Article, 'authors' | 'title' | 'sourceName' | 'publicationYear'>
): string {
  let abntAuthors = 'Unknown';
  if (article.authors) {
    abntAuthors = article.authors
      .split(', ')
      .map((author: string) => {
        const parts = author.split(' ');
        if (parts.length > 1) return `${parts.pop()?.toUpperCase()}, ${parts.join(' ')}`;
        return author.toUpperCase();
      })
      .join('; ');
  }
  return `${abntAuthors}. ${article.title}. ${article.sourceName || ''}, ${article.publicationYear || ''}.`;
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------
export function exportCsv(sel: Article[], silent = false) {
  const headers = ['Title', 'Authors', 'Year', 'DOI', 'Keywords', 'CitationCount', 'Abstract'];
  const csv =
    headers.join(',') +
    '\n' +
    sel
      .map((a) =>
        [
          `"${(a.title || '').replace(/"/g, '""')}"`,
          `"${(a.authors || '').replace(/"/g, '""')}"`,
          a.publicationYear || '',
          a.doi || '',
          `"${(a.keywords || '').replace(/"/g, '""')}"`,
          a.citationCount || '',
          `"${(a.abstract || '').replace(/"/g, '""')}"`,
        ].join(',')
      )
      .join('\n');
  downloadBlob(csv, 'text/csv;charset=utf-8;', `export_${dateStr()}.csv`);
  if (!silent)
    toast.success(`${sel.length} artigo${sel.length !== 1 ? 's' : ''} exportados em CSV`);
}

export function exportBibtex(sel: Article[], silent = false) {
  const content = sel
    .map((a) => {
      const authorStr = a.authors ? a.authors.split(', ').join(' and ') : 'Unknown';
      return (
        `@article{${a.doi ? a.doi.replace(/\//g, '_') : 'ref' + (a.publicationYear || '')},\n` +
        `  title={${a.title}},\n  author={${authorStr}},\n` +
        `  year={${a.publicationYear || 'unknown'}},\n  url={${a.originalUrl}}` +
        `${a.doi ? `,\n  doi={${a.doi}}` : ''}` +
        `${a.publisher ? `,\n  publisher={${a.publisher}}` : ''}\n}`
      );
    })
    .join('\n\n');
  downloadBlob(content, 'text/plain;charset=utf-8;', `references_${dateStr()}.bib`);
  if (!silent)
    toast.success(`${sel.length} referência${sel.length !== 1 ? 's' : ''} exportadas em BibTeX`);
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------
function downloadBlob(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function dateStr() {
  return new Date().toISOString().split('T')[0];
}

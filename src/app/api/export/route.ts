/**
 * /api/export
 * P-21: Exportação de artigos em BibTeX ou JSON.
 *
 * GET /api/export?query_id={uuid}&format=bibtex|json
 *
 * Formatos suportados:
 *   bibtex — BibTeX (.bib) para gestores de referências (Zotero, Mendeley…)
 *   json   — JSON estruturado com todos os metadados
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import type { InferSelectModel } from 'drizzle-orm';

type Article = InferSelectModel<typeof articles>;

// ---------------------------------------------------------------------------
// BibTeX helpers
// ---------------------------------------------------------------------------

/** Escapa caracteres especiais do LaTeX para uso em campos BibTeX. */
function escapeBibTeX(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\~{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

/** Gera uma chave BibTeX legível: PrimeiroAutorAnoTítulo (sem espaços). */
function bibKey(article: Article): string {
  const firstAuthor =
    (article.authors ?? 'Unknown').split(',')[0]!.trim().split(' ').pop() ?? 'Unknown';

  const year = article.publicationYear ?? 'XXXX';

  const titleWord = (article.title ?? 'Untitled')
    .split(/\s+/)
    .slice(0, 2)
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '');

  return `${firstAuthor}${year}${titleWord}`.slice(0, 50);
}

/** Converte um artigo para entrada BibTeX. */
function articleToBibTeX(article: Article, index: number): string {
  const key = bibKey(article) || `article${index}`;
  const type = article.doi || article.isOpenAccess ? '@article' : '@misc';

  const fields: string[] = [];

  if (article.title) fields.push(`  title     = {${escapeBibTeX(article.title)}}`);
  if (article.authors) fields.push(`  author    = {${escapeBibTeX(article.authors)}}`);
  if (article.publicationYear) fields.push(`  year      = {${article.publicationYear}}`);
  if (article.sourceName) fields.push(`  journal   = {${escapeBibTeX(article.sourceName)}}`);
  if (article.doi) fields.push(`  doi       = {${escapeBibTeX(article.doi)}}`);
  if (article.doi) {
    fields.push(`  url       = {https://doi.org/${escapeBibTeX(article.doi)}}`);
  } else if (article.originalUrl) {
    fields.push(`  url       = {${escapeBibTeX(article.originalUrl)}}`);
  }
  if (article.publisher) fields.push(`  publisher = {${escapeBibTeX(article.publisher)}}`);
  if (article.keywords) fields.push(`  keywords  = {${escapeBibTeX(article.keywords)}}`);
  if (article.abstract) {
    // Trunca abstracts muito longos para não tornar o .bib ilegível
    const abstractTrunc = article.abstract.slice(0, 1500);
    fields.push(`  abstract  = {${escapeBibTeX(abstractTrunc)}}`);
  }
  if (article.citationCount !== null && article.citationCount !== undefined) {
    fields.push(`  note      = {Citações: ${article.citationCount}}`);
  }

  return `${type}{${key},\n${fields.join(',\n')}\n}`;
}

/** Converte uma lista de artigos para string BibTeX completa. */
function articlesToBibTeX(articleList: Article[], queryTitle: string): string {
  const header = [
    `% BibTeX export — SOL Open Library Assistant`,
    `% Query: ${queryTitle}`,
    `% Exportado em: ${new Date().toISOString()}`,
    `% ${articleList.length} referência${articleList.length !== 1 ? 's' : ''}`,
    '',
  ].join('\n');

  const entries = articleList.map((a, i) => articleToBibTeX(a, i)).join('\n\n');
  return `${header}\n${entries}\n`;
}

// ---------------------------------------------------------------------------
// JSON export helper
// ---------------------------------------------------------------------------

function articlesToJSON(articleList: Article[], queryTitle: string): object {
  return {
    exportedAt: new Date().toISOString(),
    query: queryTitle,
    total: articleList.length,
    articles: articleList.map((a) => ({
      title: a.title,
      authors: a.authors,
      year: a.publicationYear,
      doi: a.doi,
      url: a.doi ? `https://doi.org/${a.doi}` : a.originalUrl,
      source: a.sourceName,
      abstract: a.abstract,
      keywords: a.keywords,
      citationCount: a.citationCount,
      publisher: a.publisher,
      isOpenAccess: a.isOpenAccess,
      tldr: a.tldrContent,
    })),
  };
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('query_id');
    const format = (searchParams.get('format') ?? 'bibtex').toLowerCase();
    const chatId = searchParams.get('chat_id');

    if (!queryId && !chatId) {
      return NextResponse.json({ error: 'Forneça query_id ou chat_id.' }, { status: 400 });
    }

    if (!['bibtex', 'json'].includes(format)) {
      return NextResponse.json({ error: 'Formato inválido. Use bibtex ou json.' }, { status: 400 });
    }

    // Busca os artigos
    let queryTitle = 'Exportação';
    let articleList: Article[] = [];

    if (queryId) {
      // Exporta artigos de uma query específica
      const [query] = await db
        .select({ originalQuery: searchQueries.originalQuery })
        .from(searchQueries)
        .where(eq(searchQueries.id, queryId))
        .limit(1);

      queryTitle = query?.originalQuery ?? queryId;

      articleList = await db
        .select()
        .from(articles)
        .where(eq(articles.queryId, queryId))
        .orderBy(articles.citationCount);
    } else if (chatId) {
      // Exporta todos os artigos de uma sessão de chat
      const queries = await db
        .select({ id: searchQueries.id, originalQuery: searchQueries.originalQuery })
        .from(searchQueries)
        .where(eq(searchQueries.chatId, chatId));

      queryTitle = queries.map((q) => q.originalQuery).join(' | ') || chatId;

      for (const q of queries) {
        const arts = await db.select().from(articles).where(eq(articles.queryId, q.id));
        articleList.push(...arts);
      }

      // Remove duplicatas por DOI/URL
      const seen = new Set<string>();
      articleList = articleList.filter((a) => {
        const key = a.doi ?? a.originalUrl;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (articleList.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum artigo encontrado para exportação.' },
        { status: 404 }
      );
    }

    logger.log(
      `[Export] ${format.toUpperCase()} | ${articleList.length} artigos | chatId=${chatId ?? 'n/a'} | queryId=${queryId ?? 'n/a'}`
    );

    // Gera o conteúdo no formato solicitado
    if (format === 'bibtex') {
      const bibtex = articlesToBibTeX(articleList, queryTitle);
      const filename = `sol-export-${Date.now()}.bib`;

      return new Response(bibtex, {
        headers: {
          'Content-Type': 'application/x-bibtex; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    } else {
      const json = articlesToJSON(articleList, queryTitle);
      const filename = `sol-export-${Date.now()}.json`;

      return new Response(JSON.stringify(json, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }
  } catch (error: unknown) {
    logger.error('[Export] Erro interno:', error);
    return NextResponse.json({ error: 'Erro interno durante a exportação.' }, { status: 500 });
  }
}

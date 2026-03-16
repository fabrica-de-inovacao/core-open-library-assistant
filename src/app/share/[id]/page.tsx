import { connection } from 'next/server';
import { db } from '@/server/db';
import { searchQueries, articles } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Library, ExternalLink, FileText, Calendar, Quote } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

interface SharePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const query = await db
    .select({ originalQuery: searchQueries.originalQuery })
    .from(searchQueries)
    .where(eq(searchQueries.id, id))
    .limit(1);

  if (!query.length) return { title: 'Pesquisa não encontrada | C.O.R.E.' };
  return {
    title: `${query[0].originalQuery} | C.O.R.E.`,
    description: 'Revisão sistemática gerada pelo C.O.R.E. — Corpus Orchestration & Retrieval Engine.',
  };
}

export default async function SharePage({ params }: SharePageProps) {
  await connection();
  const { id } = await params;

  // Carregar query
  const [query] = await db.select().from(searchQueries).where(eq(searchQueries.id, id)).limit(1);

  if (!query) notFound();

  // Carregar artigos (excluindo markdownContent por performance)
  const queryArticles = await db
    .select({
      id: articles.id,
      title: articles.title,
      authors: articles.authors,
      sourceName: articles.sourceName,
      publicationYear: articles.publicationYear,
      doi: articles.doi,
      originalUrl: articles.originalUrl,
      status: articles.status,
      tldrContent: articles.tldrContent,
      abstract: articles.abstract,
      citationCount: articles.citationCount,
      isOpenAccess: articles.isOpenAccess,
    })
    .from(articles)
    .where(eq(articles.queryId, id));

  const doneArticles = queryArticles.filter(
    (a) => a.status === 'done' || a.status === 'abstract_only'
  );
  const totalFound = queryArticles.length;

  return (
    <div className="bg-background text-foreground min-h-screen font-sans">
      {/* Header público */}
      <header className="border-border border-b px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex aspect-square size-7 items-center justify-center rounded-lg">
              <Library className="size-4" />
            </div>
            <span className="font-semibold tracking-tight">C.O.R.E.</span>
          </Link>
          <Badge variant="secondary" className="text-xs">
            Revisão Pública · Read-only
          </Badge>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        {/* Título da pesquisa */}
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Revisão Sistemática
          </p>
          <h1 className="text-foreground text-2xl leading-tight font-bold tracking-tight">
            {query.originalQuery}
          </h1>
          <div className="text-muted-foreground flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" />
              {new Date(query.createdAt).toLocaleDateString('pt-BR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span>·</span>
            <span>{totalFound} artigos encontrados</span>
            {doneArticles.length > 0 && (
              <>
                <span>·</span>
                <span>{doneArticles.length} processados</span>
              </>
            )}
          </div>
        </div>

        {/* Summary da query (se houver) */}
        {query.summary && (
          <Card className="border-sky-100 bg-sky-50/50 dark:border-sky-900/30 dark:bg-sky-900/10">
            <CardContent className="pt-5">
              <p className="text-sm leading-relaxed">{query.summary}</p>
            </CardContent>
          </Card>
        )}

        {/* Lista de artigos */}
        {doneArticles.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            Nenhum artigo processado nesta pesquisa.
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-base font-semibold tracking-tight">
              Artigos ({doneArticles.length})
            </h2>
            {doneArticles.map((article, idx) => (
              <Card key={article.id} className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <span className="text-muted-foreground mt-0.5 text-xs font-bold tabular-nums">
                      [{idx + 1}]
                    </span>
                    <div className="flex-1 space-y-1">
                      <h3 className="text-sm leading-snug font-semibold">
                        {article.originalUrl ? (
                          <a
                            href={article.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary hover:underline"
                          >
                            {article.title}
                            <ExternalLink className="ml-1 inline size-3 opacity-60" />
                          </a>
                        ) : (
                          article.title
                        )}
                      </h3>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                        {article.authors && (
                          <span className="max-w-[300px] truncate">{article.authors}</span>
                        )}
                        {article.publicationYear && (
                          <>
                            <span>·</span>
                            <span>{article.publicationYear}</span>
                          </>
                        )}
                        {article.sourceName && (
                          <>
                            <span>·</span>
                            <span className="italic">{article.sourceName}</span>
                          </>
                        )}
                        {article.citationCount != null && article.citationCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-0.5">
                              <Quote className="size-2.5" />
                              {article.citationCount}
                            </span>
                          </>
                        )}
                        {article.isOpenAccess && (
                          <Badge
                            variant="outline"
                            className="h-4 border-emerald-300 px-1 py-0 text-[10px] text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                          >
                            Open Access
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {article.tldrContent && (
                  <CardContent className="pt-0 pb-4">
                    <div className="bg-muted/50 rounded-md px-3 py-2">
                      <p className="text-muted-foreground mb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                        TL;DR
                      </p>
                      <p className="text-sm leading-relaxed">{article.tldrContent}</p>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="border-border border-t pt-6 pb-10 text-center">
          <p className="text-muted-foreground text-xs">
            Gerado por{' '}
            <Link href="/" className="text-primary hover:underline">
              C.O.R.E.
            </Link>{' '}
            · Revisão sistemática assistida por IA
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <FileText className="text-muted-foreground size-4" />
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground text-xs hover:underline"
            >
              Criar minha própria revisão →
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

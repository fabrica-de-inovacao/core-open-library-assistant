import { db } from '@/server/db';
import { searchQueries, articles, chatSessions } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Library, ExternalLink, FileText, Calendar, Quote, FolderSearch } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

interface ShareChatPageProps {
  params: Promise<{ chatId: string }>;
}

export async function generateMetadata({ params }: ShareChatPageProps): Promise<Metadata> {
  const { chatId } = await params;
  const session = await db
    .select({ title: chatSessions.title })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatId))
    .limit(1);

  const title = session[0]?.title;
  if (title) {
    return {
      title: `${title} | SOL Open Library Assistant`,
      description: 'Revisão sistemática gerada pelo SOL Open Library Assistant.',
    };
  }

  // Fallback: usa a primeira query
  const firstQuery = await db
    .select({ originalQuery: searchQueries.originalQuery })
    .from(searchQueries)
    .where(eq(searchQueries.chatId, chatId))
    .limit(1);

  if (!firstQuery.length) return { title: 'Sessão não encontrada | SOL Open' };
  return {
    title: `${firstQuery[0].originalQuery} | SOL Open Library Assistant`,
    description: 'Revisão sistemática gerada pelo SOL Open Library Assistant.',
  };
}

export default async function ShareChatPage({ params }: ShareChatPageProps) {
  const { chatId } = await params;

  // Carrega sessão (pode ser null para chats antigos sem chatSession)
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, chatId))
    .limit(1);

  // Carrega todas as queries desta sessão
  const queries = await db.select().from(searchQueries).where(eq(searchQueries.chatId, chatId));

  if (queries.length === 0) notFound();

  const queryIds = queries.map((q) => q.id);

  // Carrega todos os artigos dessas queries (excluindo markdownContent por performance)
  const allArticles =
    queryIds.length > 0
      ? await db
          .select({
            id: articles.id,
            queryId: articles.queryId,
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
          .where(inArray(articles.queryId, queryIds))
      : [];

  // Organiza artigos por queryId
  const articlesByQuery = new Map<string, typeof allArticles>();
  for (const article of allArticles) {
    if (!articlesByQuery.has(article.queryId)) {
      articlesByQuery.set(article.queryId, []);
    }
    articlesByQuery.get(article.queryId)!.push(article);
  }

  const totalArticles = allArticles.filter(
    (a) => a.status === 'done' || a.status === 'abstract_only'
  ).length;

  const pageTitle =
    session?.title ??
    queries[0].originalQuery.slice(0, 80) + (queries[0].originalQuery.length > 80 ? '…' : '');

  return (
    <div className="bg-background text-foreground min-h-screen font-sans">
      {/* Header público */}
      <header className="border-border border-b px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex aspect-square size-7 items-center justify-center rounded-lg">
              <Library className="size-4" />
            </div>
            <span className="font-semibold tracking-tight">SOL Open</span>
          </Link>
          <Badge variant="secondary" className="text-xs">
            Sessão Pública · Read-only
          </Badge>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="mx-auto max-w-4xl space-y-10 px-6 py-10">
        {/* Título da sessão */}
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Sessão de Revisão Sistemática
          </p>
          <h1 className="text-foreground text-2xl leading-tight font-bold tracking-tight">
            {pageTitle}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" />
              {new Date(queries[0].createdAt).toLocaleDateString('pt-BR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <FolderSearch className="size-3.5" />
              {queries.length} {queries.length === 1 ? 'busca' : 'buscas'}
            </span>
            <span>·</span>
            <span>{totalArticles} artigos processados</span>
          </div>
        </div>

        {/* Lista de queries com seus artigos */}
        {queries.map((query, qIdx) => {
          const qArticles = articlesByQuery.get(query.id) ?? [];
          const doneArticles = qArticles.filter(
            (a) => a.status === 'done' || a.status === 'abstract_only'
          );

          return (
            <section key={query.id} className="space-y-4">
              {/* Cabeçalho da query */}
              <div className="flex items-start gap-3">
                <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums">
                  Q{qIdx + 1}
                </span>
                <div className="space-y-0.5">
                  <h2 className="text-base leading-snug font-semibold tracking-tight">
                    {query.originalQuery}
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    {qArticles.length} encontrados · {doneArticles.length} processados
                  </p>
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

              {/* Artigos */}
              {doneArticles.length === 0 ? (
                <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
                  Nenhum artigo processado nesta busca.
                </div>
              ) : (
                <div className="space-y-3">
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
            </section>
          );
        })}

        {/* Footer */}
        <footer className="border-border border-t pt-6 pb-10 text-center">
          <p className="text-muted-foreground text-xs">
            Gerado por{' '}
            <Link href="/" className="text-primary hover:underline">
              SOL Open Library Assistant
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

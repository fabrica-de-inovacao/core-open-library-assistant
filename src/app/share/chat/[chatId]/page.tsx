import { db } from '@/server/db';
import { searchQueries, articles, chatSessions } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Library,
  ExternalLink,
  FileText,
  Calendar,
  Quote,
  FolderSearch,
} from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getChatMessages } from '@/server/actions/chat';
import { ShareSidebar, type SidebarArticle, type SidebarMessage } from './ShareSidebar';

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
      title: `${title} | C.O.R.E.`,
      description: 'Revisão sistemática gerada pelo C.O.R.E. — Corpus Orchestration & Retrieval Engine.',
    };
  }

  const firstQuery = await db
    .select({ originalQuery: searchQueries.originalQuery })
    .from(searchQueries)
    .where(eq(searchQueries.chatId, chatId))
    .limit(1);

  if (!firstQuery.length) return { title: 'Sessão não encontrada | C.O.R.E.' };
  return {
    title: `${firstQuery[0].originalQuery} | C.O.R.E.`,
    description: 'Revisão sistemática gerada pelo C.O.R.E. — Corpus Orchestration & Retrieval Engine.',
  };
}

export default async function ShareChatPage({ params }: ShareChatPageProps) {
  const { chatId } = await params;

  // Carrega sessão
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, chatId))
    .limit(1);

  // Carrega queries desta sessão
  const queries = await db.select().from(searchQueries).where(eq(searchQueries.chatId, chatId));

  if (queries.length === 0) notFound();

  const queryIds = queries.map((q) => q.id);

  // Carrega artigos (sem markdownContent por performance)
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

  // Carrega mensagens do chat (user + assistant apenas)
  const rawMessages = await getChatMessages(chatId);
  const sidebarMessages: SidebarMessage[] = rawMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .flatMap((m) => {
      const textParts = m.parts
        .filter((p: { type: string; text?: string }) => p.type === 'text' && p.text?.trim())
        .map((p: { type: string; text?: string }) => p.text ?? '');
      if (textParts.length === 0) return [];
      const text = textParts.join('\n');
      // Filter out system-injected user messages (e.g. [SISTEMA] instructions)
      if (text.trimStart().startsWith('[SISTEMA]')) return [];
      return [
        {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          text,
        },
      ];
    });

  // Organiza artigos por queryId
  const articlesByQuery = new Map<string, typeof allArticles>();
  for (const article of allArticles) {
    if (!articlesByQuery.has(article.queryId)) {
      articlesByQuery.set(article.queryId, []);
    }
    articlesByQuery.get(article.queryId)!.push(article);
  }

  const processedArticles = allArticles.filter(
    (a) => a.status === 'done' || a.status === 'abstract_only'
  );

  const totalArticles = processedArticles.length;

  const pageTitle =
    session?.title ??
    queries[0].originalQuery.slice(0, 80) + (queries[0].originalQuery.length > 80 ? '…' : '');

  // Sidebar data
  const sidebarArticles: SidebarArticle[] = processedArticles.map((a) => ({
    id: a.id,
    title: a.title,
    authors: a.authors,
    publicationYear: a.publicationYear,
    sourceName: a.sourceName,
    originalUrl: a.originalUrl,
    isOpenAccess: a.isOpenAccess,
    tldrContent: a.tldrContent,
  }));

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden font-sans">
      {/* Header público */}
      <header className="border-border shrink-0 border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex aspect-square size-7 items-center justify-center rounded-lg">
              <Library className="size-4" />
            </div>
            <span className="font-semibold tracking-tight">C.O.R.E.</span>
          </Link>
          <Badge variant="secondary" className="text-xs">
            Sessão Pública · Read-only
          </Badge>
        </div>
      </header>

      {/* Body: main + sidebar */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main content */}
        <main className="flex-1 overflow-y-auto px-6 py-10">
          <div className="mx-auto max-w-3xl space-y-10">
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
          </div>
        </main>

        {/* Sidebar */}
        <ShareSidebar articles={sidebarArticles} messages={sidebarMessages} />
      </div>
    </div>
  );
}

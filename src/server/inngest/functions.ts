import { inngest } from './client';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import { getEmbeddingModel, getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
import { logger } from '@/lib/logger';
import { CrossRefResponseSchema, CrossRefSearchResponseSchema } from '@/lib/schemas/crossref';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
dotenv.config();

export const processArticlesBatch = inngest.createFunction(
  {
    id: 'process-articles-batch',
    // E-01: retry automático em falhas transitórias (rede, LLM 5xx)
    retries: 2,
    concurrency: { limit: 3 },
    // Cancelamento: quando o cliente envia app/search.cancelled com o mesmo query_id,
    // o Inngest interrompe esta função antes do próximo step.
    cancelOn: [{ event: 'app/search.cancelled', match: 'data.query_id' }],
  },
  { event: 'app/process.articles.batch' },
  async ({ event, step }) => {
    const { article_ids, query_id, tldr_lang } = event.data as {
      article_ids: string[];
      query_id: string;
      tldr_lang?: string;
    };
    // Fase 7 (P-settings): idioma dinâmico conforme preferência do usuário
    const tldrLangLabel =
      tldr_lang === 'en-US' ? 'English' : tldr_lang === 'es' ? 'Español' : 'Português do Brasil';
    logger.log(
      `\n[Inngest] 📥 Evento recebido: app/process.articles.batch | query_id=${query_id} | article_ids=${JSON.stringify(article_ids)}`
    );

    // 1. Fetch articles from DB
    const pendingArticles = await step.run('fetch-articles', async () => {
      const result = await db.select().from(articles).where(inArray(articles.id, article_ids));
      // Deduplicação: pula artigos já processados em outras queries (DOI match)
      // O search/route.ts copia artigos já processados com status=done/abstract_only.
      // Inngest NÃO precisa reprocessar — eles já têm tldrContent e metadados.
      const TERMINAL = ['done', 'abstract_only'];
      const toProcess = result.filter((a) => !TERMINAL.includes(a.status ?? ''));
      if (toProcess.length < result.length) {
        logger.log(
          `[Inngest] ♻️ ${result.length - toProcess.length} artigo(s) já processados (cache) — pulando | ${toProcess.length} para processar`
        );
      } else {
        logger.log(`[Inngest] 📚 ${toProcess.length} artigo(s) para processar`);
      }
      return toProcess;
    });

    // ── Relevance Gate ────────────────────────────────────────────────────────
    // Verifica se os artigos são pertinentes ao tópico ANTES de iniciar a pipeline
    // custosa (PDF extraction, embeddings, TL;DR). Evita gastar processamento em
    // resultados irrelevantes para a pergunta do usuário.
    // NOTA: buscas globais (OpenAlex) já vêm semanticamente filtradas — pulamos o gate.
    const relevanceGate = await step.run('analyze-relevance', async () => {
      // Verifica se outro batch já marcou needs_refinement ou cancelled
      const [qData] = await db
        .select({
          status: searchQueries.status,
          originalQuery: searchQueries.originalQuery,
          expandedQuery: searchQueries.expandedQuery,
        })
        .from(searchQueries)
        .where(eq(searchQueries.id, query_id))
        .limit(1);

      if (qData?.status === 'needs_refinement' || qData?.status === 'cancelled') {
        return { proceed: false, reason: qData.status as string };
      }
      if (qData?.status === 'done') {
        return { proceed: true, reason: 'already_done' };
      }

      // OpenAlex já filtra semanticamente — não aplicar RelevanceGate
      if (qData?.expandedQuery === 'source:openalex') {
        return { proceed: true, reason: 'openalex_skip' };
      }

      const topic = qData?.originalQuery ?? '';
      // Busca todos os títulos da query (inclui artigos de outros batches simultâneos)
      const allTitles = await db
        .select({ title: articles.title })
        .from(articles)
        .where(eq(articles.queryId, query_id));

      if (allTitles.length === 0) return { proceed: true, reason: 'no_titles' };

      const titlesContext = allTitles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
      logger.log(
        `[Inngest] 🔍 Verificando relevância | query_id=${query_id} | artigos=${allTitles.length} | topic="${topic.slice(0, 60)}…"`
      );

      let analysis: { relevant: boolean; relevant_count: number; reason: string } = {
        relevant: true,
        relevant_count: allTitles.length,
        reason: '',
      };
      try {
        const { text } = await generateText({
          model: getModelForTask('tldr'),
          // Sem thinking — precisa ser rápido e não requer raciocínio complexo
          providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
          abortSignal: AbortSignal.timeout(20_000),
          system:
            'Você é um avaliador de relevância de literatura científica. Responda APENAS com JSON válido, sem markdown.',
          prompt: `Tópico de pesquisa: "${topic}"\n\nTítulos dos artigos encontrados:\n${titlesContext}\n\nEsses artigos são relevantes para o tópico acima? Responda APENAS com JSON no formato: {"relevant":true/false,"relevant_count":<n>,"reason":"<brevíssima justificativa em pt-BR>"}`,
        });
        const cleaned = text
          .trim()
          .replace(/^```json\n?/, '')
          .replace(/\n?```$/, '');
        analysis = JSON.parse(cleaned) as typeof analysis;
      } catch (err) {
        // Falha no LLM → assume relevante para não bloquear o processamento
        logger.warn(
          '[Inngest] ⚠️ Relevance check falhou — assumindo relevante:',
          (err as Error).message
        );
        return { proceed: true, reason: 'llm_error' };
      }

      logger.log(
        `[Inngest] 🔍 Relevance result | relevant=${analysis.relevant} | count=${analysis.relevant_count} | reason="${analysis.reason}"`
      );

      const MIN_RELEVANT = 3;
      if (!analysis.relevant || analysis.relevant_count < MIN_RELEVANT) {
        await db
          .update(searchQueries)
          .set({
            status: 'needs_refinement',
            summary: JSON.stringify({
              reason: analysis.reason,
              relevant_count: analysis.relevant_count,
            }),
          })
          .where(eq(searchQueries.id, query_id));
        // Marca artigos pendentes como failed para não poluir o acervo
        await db
          .update(articles)
          .set({ status: 'failed' })
          .where(and(eq(articles.queryId, query_id), eq(articles.status, 'pending')));
        logger.log(
          `[Inngest] 🚫 Artigos não relevantes — processamento cancelado | reason="${analysis.reason}"`
        );
        return { proceed: false, reason: 'not_relevant', analysis };
      }

      return { proceed: true, reason: 'ok' };
    });

    if (!relevanceGate.proceed) {
      logger.log(
        `[Inngest] ⏭️ Relevance gate: skipping processing | reason=${relevanceGate.reason}`
      );
      return { success: false, skipped: true, reason: relevanceGate.reason };
    }

    for (const article of pendingArticles) {
      // Guard: interrompe o loop se a query foi cancelada pelo utilizador entre steps.
      // Leitura direta (fora de step.run) é segura — sem side effects.
      const [qStatus] = await db
        .select({ status: searchQueries.status })
        .from(searchQueries)
        .where(eq(searchQueries.id, query_id))
        .limit(1);
      if (qStatus?.status === 'cancelled') {
        logger.log(
          `[Inngest] 🛑 Query cancelada pelo utilizador | query_id=${query_id} — interrompendo processamento.`
        );
        break;
      }

      // E-03: isolação por artigo — falha em 1 não cancela o batch inteiro
      try {
        // Fase 3 (P-PDF/P-DOI): documentos enviados pelo usuário já têm conteúdo extraído
        const isUserUpload =
          article.metadataSource === 'user_upload' || article.metadataSource === 'user_doi';

        const scrapeResult = (await step.run(`scrape-detail-page-${article.id}`, async () => {
          // ── STEP 1: Scrape article detail page for DOI + Keywords ──
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);
            const response = await fetch(article.originalUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOLAssistant/1.0)' },
              signal: controller.signal,
            }).finally(() => clearTimeout(timeout));

            if (!response.ok) {
              logger.warn(`[Inngest] ⚠️ Detail page returned ${response.status} for ${article.id}`);
              return;
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            // DOI: best from <meta name="citation_doi"> or div.item.doi a
            const doi =
              $('meta[name="citation_doi"]').attr('content')?.trim() ||
              $('div.item.doi .value a').first().text().trim().replace('https://doi.org/', '') ||
              null;

            // Keywords: div.item.keywords .value text (comma-separated)
            const rawKeywords = $('div.item.keywords .value').text().trim();
            const keywords = rawKeywords || null;

            // Abstract: try meta[name="DC.Description"] first, then div.item.abstract .value
            const abstract =
              $('meta[name="DC.Description"]').attr('content')?.trim() ||
              $('div.item.abstract .value').text().trim() ||
              null;

            logger.log(
              `[Inngest] ✅ Detail scrape OK | doi=${doi ?? 'N/A'} | keywords_found=${!!keywords} | abstract_found=${!!abstract}`
            );

            // Only update if we found something new
            const updates: Record<string, string | null> = {};
            if (doi && !article.doi) updates.doi = doi;
            if (keywords) updates.keywords = keywords;
            if (abstract) updates.abstract = abstract;

            if (Object.keys(updates).length > 0) {
              await db.update(articles).set(updates).where(eq(articles.id, article.id));
            }

            // Return doi so next step can use it
            return { doi: doi ?? article.doi ?? null };
          } catch (err) {
            const isAbort = (err as Error).name === 'AbortError';
            logger.warn(
              `[Inngest] ⏱️ Detail scrape ${isAbort ? 'timeout' : 'falhou'} para ${article.id}: ${(err as Error).message}`
            );
            return { doi: article.doi ?? null };
          }
        })) as { doi: string | null };

        // ── NEW STEP 2: CrossRef Enrichment ──
        if (scrapeResult?.doi) {
          await step.run(`crossref-enrich-${article.id}`, async () => {
            const doi = scrapeResult.doi!;
            logger.log(`[Inngest] 🌐 CrossRef lookup for doi=${doi}`);
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10_000);
              const response = await fetch(
                `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
                {
                  headers: { 'User-Agent': 'SOLAssistant/1.0 (mailto:dev@example.com)' },
                  signal: controller.signal,
                }
              ).finally(() => clearTimeout(timeout));

              if (!response.ok) {
                logger.warn(`[Inngest] ⚠️ CrossRef returned ${response.status} for doi=${doi}`);
                return;
              }

              const rawData = await response.json();
              const parsed = CrossRefResponseSchema.safeParse(rawData);
              if (!parsed.success) {
                logger.warn(
                  `[Inngest] ⚠️ CrossRef response schema inválido para doi=${doi}:`,
                  parsed.error.issues
                );
                return;
              }
              const data = parsed.data;
              if (data.status !== 'ok' || !data.message) return;

              const work = data.message;
              const abstract = work.abstract?.replace(/<\/?jats:[^>]+>/g, '')?.trim() || null;
              const keywords =
                [...(work.keyword ?? []), ...(work.subject ?? [])].join(', ') || null;
              const citationCount = work['is-referenced-by-count'] ?? null;
              const publisher = work.publisher ?? null;
              const isOpenAccess = (work.license?.length ?? 0) > 0;

              logger.log(
                `[Inngest] 📊 CrossRef OK | citations=${citationCount} | keywords_found=${!!keywords}`
              );
              await db
                .update(articles)
                .set({
                  abstract: abstract ?? undefined,
                  keywords: keywords ?? undefined,
                  citationCount: citationCount ?? undefined,
                  publisher: publisher ?? undefined,
                  isOpenAccess,
                  metadataSource: 'crossref',
                })
                .where(eq(articles.id, article.id));
            } catch (err) {
              const isAbort = (err as Error).name === 'AbortError';
              logger.warn(
                `[Inngest] ⏱️ CrossRef ${isAbort ? 'timeout' : 'falhou'} para doi=${doi}: ${(err as Error).message}`
              );
            }
          });
        }

        // ── STEP 3: Compute abstract embedding for semantic reranking ──
        await step.run(`embed-abstract-${article.id}`, async () => {
          // Re-fetch the latest abstract (may have been enriched by CrossRef above)
          const [fresh] = await db
            .select({ abstract: articles.abstract, tldrContent: articles.tldrContent })
            .from(articles)
            .where(eq(articles.id, article.id));

          const text = fresh?.abstract ?? fresh?.tldrContent;
          if (!text) {
            logger.log(`[Inngest] ⏭️  Sem abstract para embedding | article=${article.id}`);
            return;
          }

          try {
            const { embedding } = await embed({
              model: getEmbeddingModel(),
              value: text.slice(0, 2000), // cap para controle de custo
            });
            await db
              .update(articles)
              // P-19: abstractEmbedding é agora vector(768) — passa number[] diretamente (sem JSON.stringify)
              .set({ abstractEmbedding: embedding })
              .where(eq(articles.id, article.id));
            logger.log(
              `[Inngest] 🧮 Embedding computado | article=${article.id} | dims=${embedding.length}`
            );
          } catch (err) {
            // Embedding não é crítico — falha silenciosa para não bloquear o pipeline
            logger.warn(
              `[Inngest] ⚠️  Embedding falhou para article=${article.id}:`,
              (err as Error).message
            );
          }
        });

        // E-05: rejeitar PDFs acima de 20 MB antes de invocar o worker (pula para user_upload)
        const PDF_SIZE_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MB
        if (article.originalUrl && !isUserUpload) {
          try {
            const headRes = await fetch(article.originalUrl, { method: 'HEAD' });
            const contentLength = parseInt(headRes.headers.get('content-length') ?? '0', 10);
            if (contentLength > PDF_SIZE_LIMIT_BYTES) {
              logger.warn(
                `[Inngest] ⚠️ PDF muito grande (${Math.round(contentLength / 1024 / 1024)}MB), pulando extração | article=${article.id}`
              );
              await step.run(`mark-abstract-only-${article.id}`, async () => {
                await db
                  .update(articles)
                  .set({ status: 'abstract_only' })
                  .where(eq(articles.id, article.id));
              });
              continue;
            }
          } catch {
            // HEAD falhou — continua e deixa o worker decidir
          }
        }

        // 2. Call Python Worker for PDF extraction (pulado para user_upload — conteúdo já extraído)
        let markdownContent: string;

        if (isUserUpload) {
          // Fase 3 (P-PDF/P-DOI): Markdown já foi extraído/preenchido pela rota e persistido no DB
          markdownContent = article.markdownContent ?? '';
          logger.log(
            `[Inngest] ⏭️  ${article.metadataSource} — pulando extração de PDF | article=${article.id} | chars=${markdownContent.length}`
          );
        } else {
          // A-03: URL via env var (PYTHON_WORKER_URL), fallback para localhost em dev
          const WORKER_BASE = process.env.PYTHON_WORKER_URL ?? 'http://127.0.0.1:8000';
          const extractionResult = await step.run(`extract-pdf-${article.id}`, async () => {
            logger.log(
              `[Inngest] 🔄 Chamando Python Worker | article=${article.id} | worker=${WORKER_BASE}`
            );
            try {
              const response = await fetch(`${WORKER_BASE}/extract`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  // F-01: nunca usar chave hardcoded; se env não estiver configurada, header vai vazio
                  'X-Worker-Token': process.env.WORKER_API_KEY ?? '',
                },
                body: JSON.stringify({
                  article_url: article.originalUrl,
                  force_ocr: false,
                }),
              });

              if (!response.ok) {
                throw new Error(`Worker returned ${response.status}`);
              }
              const data = (await response.json()) as {
                success: boolean;
                content_markdown?: string;
                method_used?: string;
              };
              logger.log(
                `[Inngest] 🐍 Worker OK | article=${article.id} | method=${data.method_used} | chars=${data.content_markdown?.length ?? 0}`
              );
              return data;
            } catch (error: unknown) {
              logger.error(`[Inngest] ❌ Python Worker falhou para article=${article.id}:`, error);
              return null;
            }
          });

          if (!extractionResult || !extractionResult.success) {
            await step.run(`mark-failed-${article.id}`, async () => {
              await db
                .update(articles)
                .set({ status: 'failed' })
                .where(eq(articles.id, article.id));
            });
            continue;
          }

          markdownContent = extractionResult.content_markdown || '';
          const workerStatus =
            extractionResult.method_used === 'abstract_scraping'
              ? 'abstract_only'
              : 'llm_processing';

          // Update to processing state with markdown
          // Sanitiza null bytes (U+0000) que quebram o encoding UTF-8 do Postgres.
          const safeMarkdown = markdownContent.replace(/\x00/g, '');
          await step.run(`save-markdown-${article.id}`, async () => {
            await db
              .update(articles)
              .set({
                markdownContent: safeMarkdown,
                status: workerStatus,
              })
              .where(eq(articles.id, article.id));
          });
        }

        // 2b. Fase 3 (P-PDF): inferir metadados reais via LLM + CrossRef (apenas PDFs do utilizador, não user_doi que já tem metadados)
        if (
          isUserUpload &&
          article.metadataSource === 'user_upload' &&
          markdownContent.length > 50
        ) {
          await step.run(`infer-metadata-${article.id}`, async () => {
            logger.log(`[Inngest] 🔍 Inferindo metadados do PDF | article=${article.id}`);
            try {
              // 1. LLM extrai título e autores-chave do início do texto
              const sample = markdownContent.slice(0, 2500);
              const { text: extracted } = await generateText({
                model: getModelForTask('tldr'), // Gemini Flash — barato e rápido
                abortSignal: AbortSignal.timeout(20_000),
                system:
                  'Você é um extrator de metadados de artigos científicos. Dado o início de um artigo em texto, retorne APENAS um JSON válido no formato: {"title":"<titulo completo>","authors":"<Sobrenome A, Sobrenome B>"} — sem explicações, sem markdown, apenas o JSON.',
                prompt: `Extraia título e autores deste início de artigo:\n\n${sample}`,
              });

              let parsed: { title?: string; authors?: string } = {};
              try {
                parsed = JSON.parse(extracted.trim()) as { title?: string; authors?: string };
              } catch {
                // LLM retornou texto não-JSON — abandona inferência
                logger.warn(
                  `[Inngest] ⚠️ LLM retornou JSON inválido para metadados | article=${article.id}`
                );
              }

              const inferredTitle = parsed.title?.trim();
              if (!inferredTitle || inferredTitle.length < 5) return;

              // 2. CrossRef — busca por título + autor
              const searchUrl = new URL('https://api.crossref.org/works');
              searchUrl.searchParams.set('query.bibliographic', inferredTitle);
              if (parsed.authors?.trim())
                searchUrl.searchParams.set('query.author', parsed.authors.trim());
              searchUrl.searchParams.set('rows', '3');
              // 'select' omitido: o campo 'score' não é selecionável na CrossRef API
              // e causa HTTP 400; deixar sem filtro traz todos os campos incluindo score

              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 12_000);
              const res = await fetch(searchUrl.toString(), {
                headers: { 'User-Agent': 'SOLAssistant/1.0 (mailto:contato@sol-assistant.app)' },
                signal: controller.signal,
              }).finally(() => clearTimeout(timeout));

              if (!res.ok) {
                logger.warn(
                  `[Inngest] ⚠️ CrossRef search HTTP ${res.status} | article=${article.id}`
                );
                return;
              }

              const raw = (await res.json()) as unknown;
              const parseResult = CrossRefSearchResponseSchema.safeParse(raw);
              if (!parseResult.success) return;

              const items = parseResult.data.message?.items ?? [];
              const best = items[0];
              const bestScore = best?.score ?? 0;

              if (!best || bestScore < 50) {
                logger.log(
                  `[Inngest] ⚠️ CrossRef search: sem hit confiante | score=${bestScore} | title="${inferredTitle}" | article=${article.id}`
                );
                return;
              }

              // 3. Aplica metadados reais ao artigo
              const doi = best.DOI ?? null;
              const title = best.title?.[0] ?? inferredTitle;
              const authors =
                best.author?.map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', ') ??
                parsed.authors ??
                null;
              const dateArr =
                best['published-print']?.['date-parts']?.[0] ??
                best['published-online']?.['date-parts']?.[0];
              const year = dateArr?.[0] ?? null;
              const abstract = best.abstract?.replace(/<\/?jats:[^>]+>/g, '').trim() ?? null;
              const keywords =
                [...(best.keyword ?? []), ...(best.subject ?? [])].join(', ') || null;

              logger.log(
                `[Inngest] ✅ Metadados inferidos | doi=${doi} | score=${bestScore} | title="${title}" | article=${article.id}`
              );

              await db
                .update(articles)
                .set({
                  title,
                  ...(doi ? { doi } : {}),
                  ...(authors ? { authors } : {}),
                  ...(year ? { publicationYear: year } : {}),
                  ...(best.publisher ? { publisher: best.publisher } : {}),
                  ...(best['container-title']?.[0]
                    ? { sourceName: best['container-title'][0] }
                    : {}),
                  ...(abstract ? { abstract } : {}),
                  ...(keywords ? { keywords } : {}),
                  isOpenAccess: (best.license?.length ?? 0) > 0,
                  metadataSource: 'crossref',
                })
                .where(eq(articles.id, article.id));

              // Enriquece markdownContent em memória para o TL;DR usar o abstract real
              if (abstract) {
                markdownContent =
                  `# ${title}\n\n**Resumo:** ${abstract}\n\n---\n\n` + markdownContent;
              }
            } catch (err) {
              logger.warn(
                `[Inngest] ⚠️ Inferência de metadados falhou — continuando sem ela | article=${article.id}:`,
                (err as Error).message
              );
            }
          });
        }

        // 3. Generate TL;DR via LLM using enriched context
        const tldr = await step.run(`generate-tldr-${article.id}`, async () => {
          // Re-fetch to include any enriched metadata for context
          const [enrichedArticle] = await db
            .select({ keywords: articles.keywords, abstract: articles.abstract })
            .from(articles)
            .where(eq(articles.id, article.id));

          const contextPrefix = [
            enrichedArticle?.keywords ? `Palavras-chave oficiais: ${enrichedArticle.keywords}` : '',
            enrichedArticle?.abstract
              ? `Resumo do autor: ${enrichedArticle.abstract.substring(0, 500)}`
              : '',
          ]
            .filter(Boolean)
            .join('\n');

          logger.log(
            `[Inngest] 🤖 Gerando TL;DR via LLM para article=${article.id} | provider=${process.env.LLM_PROVIDER ?? 'google'} | model=${getModelIdForTask('tldr')}`
          );
          try {
            const { text } = await generateText({
              model: getModelForTask('tldr'),
              // E-02: timeout de 45s para evitar que o step fique pendurado indefinidamente
              abortSignal: AbortSignal.timeout(45_000),
              system: `Você é um assistente acadêmico especializado em sínteses científicas. Leia o texto fornecido e crie uma síntese estruturada EXATAMENTE no seguinte formato de 3 linhas:
\uD83D\uDD0D Problema: [qual problema ou lacuna o artigo endereça, em 1 frase]
\uD83D\uDEE0 Método: [abordagem, técnica ou metodologia principal utilizada, em 1 frase]
✅ Resultado: [principal conclusão ou contribuição do trabalho, em 1 frase]
REGRAS: Máximo 600 caracteres no total. Obrigatoriamente em ${tldrLangLabel}. Sem saudações. Sem texto fora do template acima. Se o conteúdo for insuficiente, use o abstract disponível.`,
              prompt: `${contextPrefix ? contextPrefix + '\n\n' : ''}Gere a síntese estruturada do seguinte texto científico:\n\n${markdownContent.substring(0, 30000)}`,
            });
            logger.log(
              `[Inngest] ✅ TL;DR gerado para article=${article.id} | ${text.length} chars`
            );
            return text;
          } catch (error: unknown) {
            logger.error(`[Inngest] ❌ LLM falhou para article=${article.id}:`, error);
            return null;
          }
        });

        // 4. Final DB update
        await step.run(`save-tldr-${article.id}`, async () => {
          await db
            .update(articles)
            .set({
              tldrContent: tldr || 'Falha ao gerar síntese via IA.',
              status: tldr ? 'done' : 'failed',
            })
            .where(eq(articles.id, article.id));
        });
      } catch (articleErr) {
        // E-03: garante que o artigo seja marcado como 'failed' mesmo com erro inesperado
        logger.error(
          `[Inngest] ❌ Erro inesperado no processamento de article=${article.id}:`,
          articleErr
        );
        await step.run(`mark-failed-unexpected-${article.id}`, async () => {
          await db.update(articles).set({ status: 'failed' }).where(eq(articles.id, article.id));
        });
      }
    } // fim for (const article of pendingArticles)

    // Wait for other concurrent batches to finish before checking global completion.
    await step.sleep('wait-for-concurrent-batches', '8s');

    // Final step: only mark query as 'done' if ALL articles for this query are in a terminal state.
    await step.run('mark-query-done', async () => {
      const TERMINAL = ['done', 'abstract_only', 'failed'];
      const allArticles = await db
        .select({ id: articles.id, status: articles.status })
        .from(articles)
        .where(eq(articles.queryId, query_id));

      const allFinished = allArticles.every((a) => TERMINAL.includes(a.status ?? ''));
      const doneCount = allArticles.filter((a) => a.status !== 'failed').length;

      logger.log(
        `[Inngest] 🏁 Batch concluído | query_id=${query_id} | total_artigos=${allArticles.length} | terminais=${allArticles.filter((a) => TERMINAL.includes(a.status ?? '')).length} | todos_prontos=${allFinished}`
      );

      if (allFinished) {
        logger.log(
          `[Inngest] ✅ Todos os artigos terminados. Marcando query como 'done' | ok=${doneCount} | falhas=${allArticles.length - doneCount}`
        );
        await db
          .update(searchQueries)
          .set({ status: 'done' })
          .where(eq(searchQueries.id, query_id));
      } else {
        const stillPending = allArticles.filter((a) => !TERMINAL.includes(a.status ?? '')).length;
        logger.log(
          `[Inngest] ⏳ ${stillPending} artigo(s) ainda pendentes em outros batches — não marcando query como done ainda.`
        );
      }
    });

    return { success: true, processed: pendingArticles.length };
  }
);

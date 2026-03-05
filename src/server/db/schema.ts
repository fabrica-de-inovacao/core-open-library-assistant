import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  uuid,
  varchar,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import type { AdapterAccount } from 'next-auth/adapters';

// --- Auth.js Base Tables ---

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccount['type']>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

// --- Core App Tables ---

// Fase 1 (P-01): chat_sessions é o objeto primário.
// Antes o chat era ancorado em queryId (1 query = 1 se pode conversarção).
// Agora: 1 chatSession = N searchQueries + N chatMessages.
// Isso elimina todas as race conditions de segunda busca.
export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'), // título human-readable (gerado após 1ª mensagem, P-17)
  // V2: cache da sumarização de histórico longo — evita rechamar LLM a cada request.
  // Regenerado quando messages.length - conversationSummaryCount >= KEEP_RECENT (14).
  conversationSummary: text('conversation_summary'),
  conversationSummaryCount: integer('conversation_summary_count').default(0).notNull(),
  // Fase C (Batch 3): feedback pós-síntese por mensagem — { [messageId]: 'up' | 'down' }
  synthesisRatings: jsonb('synthesis_ratings').$type<Record<string, 'up' | 'down'>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- Core App Tables ---

export const searchQueries = pgTable(
  'search_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Fase 1 (P-01): chatId vincula esta query à sessão de chat mãe.
    // Nullable para compatibilidade retroativa com queries antigas.
    chatId: uuid('chat_id').references(() => chatSessions.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id),
    originalQuery: text('original_query').notNull(),
    expandedQuery: text('expanded_query'),
    summary: text('summary'), // Saved general TL;DR
    status: varchar('status', { length: 50 }).notNull(), // 'proposed', 'searching', 'processing', 'done', 'failed'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Fase 8 (P-trending): covering index para a query de trending topics.
    // WHERE status = 'done' + GROUP BY original_query — index-only scan.
    statusOriginalQueryIdx: index('search_queries_status_oq_idx').on(
      table.status,
      table.originalQuery
    ),
  })
);

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queryId: uuid('query_id')
      .notNull()
      .references(() => searchQueries.id, { onDelete: 'cascade' }),
    doi: text('doi'), // Removed global unique()
    title: text('title').notNull(),
    authors: text('authors'), // comma separated or JSON string
    sourceName: text('source_name'),
    publicationYear: integer('publication_year'),
    originalUrl: text('original_url').notNull(),
    status: varchar('status', { length: 50 }).notNull(), // 'pending', 'extracting', 'llm_processing', 'done', 'failed', 'abstract_only'
    markdownContent: text('markdown_content'),
    tldrContent: text('tldr_content'),
    // --- Enriched Metadata ---
    abstract: text('abstract'),
    keywords: text('keywords'), // comma-separated list from SOL detail page or CrossRef
    citationCount: integer('citation_count'),
    publisher: text('publisher'),
    isOpenAccess: boolean('is_open_access'),
    metadataSource: varchar('metadata_source', { length: 50 }).default('scraper'), // 'scraper' | 'crossref' | 'manual'
    // I-03: P-19 — embedding do abstract para reranking semântico.
    // Migrado de TEXT para vector(768) em 0005_pgvector_and_url_idx.sql.
    abstractEmbedding: vector('abstract_embedding', { dimensions: 768 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Ensures the same DOI is only processed once per query
    // But allows the same DOI to exist in different queries
    doiQueryIdx: uniqueIndex('doi_query_idx').on(table.queryId, table.doi),
    // P-10: garante unicidade por URL por query (artigos sem DOI também são deduplicados)
    urlQueryIdx: uniqueIndex('url_query_idx').on(table.queryId, table.originalUrl),
  })
);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Fase 1 (P-01): chatId é o novo identificador primário de sessão.
  // queryId mantido como nullable para compatibilidade retroativa.
  chatId: uuid('chat_id').references(() => chatSessions.id, { onDelete: 'cascade' }),
  queryId: uuid('query_id').references(() => searchQueries.id, { onDelete: 'set null' }),
  role: varchar('role', { length: 50 }).notNull(), // 'user', 'assistant', 'system', 'data'
  content: text('content').notNull(),
  toolInvocations: jsonb('tool_invocations'), // To store Vercel AI SDK tool calls state if needed
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

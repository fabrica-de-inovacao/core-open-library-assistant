import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  uuid,
  varchar,
  jsonb,
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

export const searchQueries = pgTable('search_queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id),
  originalQuery: text('original_query').notNull(),
  expandedQuery: text('expanded_query'),
  status: varchar('status', { length: 50 }).notNull(), // 'searching', 'processing', 'completed', 'failed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const articles = pgTable('articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryId: uuid('query_id')
    .notNull()
    .references(() => searchQueries.id, { onDelete: 'cascade' }),
  doi: text('doi').unique(),
  title: text('title').notNull(),
  authors: text('authors'), // comma separated or JSON string
  sourceName: text('source_name'),
  publicationYear: integer('publication_year'),
  originalUrl: text('original_url').notNull(),
  status: varchar('status', { length: 50 }).notNull(), // 'pending', 'extracting', 'llm_processing', 'done', 'failed', 'abstract_only'
  markdownContent: text('markdown_content'),
  tldrContent: text('tldr_content'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryId: uuid('query_id')
    .notNull()
    .references(() => searchQueries.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).notNull(), // 'user', 'assistant', 'system', 'data'
  content: text('content').notNull(),
  toolInvocations: jsonb('tool_invocations'), // To store Vercel AI SDK tool calls state if needed
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

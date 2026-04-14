import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/server/db';
import * as schema from '@/server/db/schema';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Necessário para proxies e tunnels (ngrok, Vercel, etc.) que encaminham
  // a requisição via X-Forwarded-Host — sem isso, o redirect_uri usa localhost.
  trustHost: true,
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    CredentialsProvider({
      id: 'anonymous',
      name: 'Revisão Anônima',
      credentials: {},
      async authorize() {
        const anonId = crypto.randomUUID();
        const anonEmail = `anon_${anonId}@anon.local`;

        // Cria usuário anônimo no banco dinamicamente
        const [newUser] = await db
          .insert(schema.users)
          .values({
            id: anonId,
            name: 'Revisor Anônimo',
            email: anonEmail,
            image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${anonId}`,
          })
          .returning();

        if (newUser) {
          return newUser;
        }
        return null;
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    // Persiste o id do usuário (vindo do DB via adapter) no JWT
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    // Expõe o id do JWT na session acessível via `auth()` e `useSession()`
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});

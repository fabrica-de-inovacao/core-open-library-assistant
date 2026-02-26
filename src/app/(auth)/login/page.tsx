import { signIn } from '@/auth';
import { Library } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <div className="border-border bg-card w-full max-w-sm rounded-xl border p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center justify-center">
          <div className="mb-4 flex aspect-square size-12 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg shadow-sky-500/20">
            <Library className="size-6" />
          </div>
          <h1 className="text-foreground text-center font-sans text-xl font-bold tracking-tight">
            SOL Open Library Assistant
          </h1>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            Acesse para pesquisar e gerenciar suas revisões sistemáticas da literatura.
          </p>
        </div>

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/workspace' });
          }}
        >
          <button
            type="submit"
            className="border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground flex h-12 w-full items-center justify-center gap-3 rounded-full border px-4 py-2.5 text-base font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Entrar com Google
          </button>
        </form>
      </div>
    </div>
  );
}

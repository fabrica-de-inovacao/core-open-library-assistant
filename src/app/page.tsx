import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ArrowRight } from 'lucide-react';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/workspace');
  }

  return (
    <div className="flex min-h-screen items-center bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center lg:gap-20">
        {/* ── LEFT: Brand + CTA ─────────────────────────────────────── */}
        <div className="flex flex-col items-start gap-8">
          {/* Logo mark + nome */}
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-md shadow-sm">
              <span className="font-mono text-[11px] font-black tracking-tighter">SOL</span>
            </div>
            <div>
              <p className="text-foreground text-sm font-bold tracking-tight">SOL Open Library</p>
              <p className="text-muted-foreground font-mono text-[9px] tracking-[0.18em] uppercase">
                SCBC · Biblioteca Científica
              </p>
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-zinc-950 lg:text-5xl dark:text-zinc-50">
              Revisão sistemática da literatura <span className="text-primary">com IA</span>
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-zinc-500 dark:text-zinc-400">
              Pesquise na SBC OpenLib e no OpenAlex, extraia PDFs, gere TL;DRs e sintetize revisões
              científicas em minutos — não em semanas.
            </p>
          </div>

          {/* CTA */}
          <a
            href="/login"
            className="bg-primary text-primary-foreground shadow-primary/20 hover:bg-primary/90 focus-visible:ring-primary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Entrar com Google
            <ArrowRight className="h-4 w-4" />
          </a>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {[
              'Open Access',
              'Ibero-americana',
              'Revisão Sistemática',
              'IA Generativa',
              'BibTeX & CSV',
            ].map((badge) => (
              <span
                key={badge}
                className="text-muted-foreground border-border rounded border bg-white/80 px-2.5 py-1 font-mono text-[10px] tracking-wide dark:bg-zinc-900/80"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Product preview ─────────────────────────────────── */}
        <div className="hidden flex-col gap-3 lg:flex">
          {/* App window mockup */}
          <div className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
            {/* Title bar */}
            <div className="border-border bg-muted/40 flex items-center gap-2.5 border-b px-4 py-2">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                ))}
              </div>
              <span className="text-muted-foreground/60 font-mono text-[10px]">
                sol.scbc.org / workspace
              </span>
            </div>

            {/* Chat preview */}
            <div className="space-y-3 p-4">
              {/* User msg */}
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-tr-sm px-3 py-2 text-xs">
                  IA aplicada ao ensino de engenharia no Brasil
                </div>
              </div>

              {/* Assistant response */}
              <div className="flex justify-start">
                <div className="border-border bg-card max-w-[92%] space-y-2 rounded-2xl rounded-tl-sm border px-3 py-2.5">
                  <p className="text-muted-foreground font-mono text-[9px] tracking-wider uppercase">
                    SOL Assistant
                  </p>
                  <p className="text-foreground/80 text-xs">
                    Identifiquei <strong>3 strings de busca</strong> para cobrir o tema de forma
                    sistemática.
                  </p>
                  {/* Mini proposal card */}
                  <div className="border-l-primary bg-primary/5 mt-1 rounded-r-md border-l-2 p-2">
                    <p className="text-primary font-mono text-[9px] tracking-wider uppercase">
                      SOL · 3 queries
                    </p>
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 font-mono text-[9px]">
                      &quot;machine learning&quot; AND &quot;engineering education&quot;...
                    </p>
                  </div>
                </div>
              </div>

              {/* Fake article table */}
              <div className="border-border overflow-hidden rounded-lg border">
                <div className="border-border bg-muted/30 border-b px-3 py-1.5">
                  <span className="text-muted-foreground font-mono text-[9px] tracking-wider uppercase">
                    Acervo · 12 artigos encontrados
                  </span>
                </div>
                {[
                  { title: 'Applying ML to Undergraduate CS Courses', year: '2023', done: true },
                  { title: 'Gamification in STEM Engineering Education', year: '2022', done: true },
                  { title: 'Deep Learning for Automated Assessment', year: '2024', done: false },
                ].map((a, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-3 py-2 ${i < 2 ? 'border-border border-b' : ''}`}
                  >
                    <span className="text-foreground/70 max-w-50 truncate text-[10px]">
                      {a.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground font-mono text-[9px]">{a.year}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[8px] uppercase ${
                          a.done
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-primary/5 text-primary'
                        }`}
                      >
                        {a.done ? 'done' : '···'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'SOL', label: 'SBC OpenLib' },
              { value: '250M+', label: 'papers OpenAlex' },
              { value: '< 3s', label: 'TL;DR por PDF' },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="border-border bg-card rounded-lg border px-3 py-2.5 text-center"
              >
                <p className="text-primary font-mono text-base font-bold">{value}</p>
                <p className="text-muted-foreground mt-0.5 text-[10px]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

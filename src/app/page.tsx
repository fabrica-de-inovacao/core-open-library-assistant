import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ArrowRight, BookOpenText, Search, FileText, Layers } from 'lucide-react';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/workspace');
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* ── Top bar: identidade institucional ────────────────────────── */}
      <header className="border-border/40 border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
              <BookOpenText className="size-[13px]" strokeWidth={2.5} />
            </div>
            <span className="text-foreground text-sm font-bold tracking-tight">
              SOL Open Library
            </span>
            <span className="border-border text-muted-foreground hidden rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase sm:inline-block">
              v0.9-beta
            </span>
          </div>
          <div className="text-muted-foreground/50 hidden font-mono text-[10px] tracking-widest uppercase sm:block">
            SCBC · 2026
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-12 px-6 py-14 lg:grid-cols-2 lg:items-center lg:gap-20">
        {/* ── LEFT: Brand + CTA ──────────────────────────────────────── */}
        <div className="flex flex-col items-start gap-8">
          {/* Classificador científico */}
          <div className="border-primary/30 bg-primary/5 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1">
            <span className="font-mono text-[9px] tracking-[0.25em] uppercase">
              Ferramenta de Revisão Sistemática · IA
            </span>
          </div>

          {/* Headline */}
          <div className="space-y-4">
            <h1 className="text-[2.6rem] leading-[1.15] font-bold tracking-tight text-zinc-950 lg:text-[3.2rem] dark:text-zinc-50">
              Pesquisa científica
              <br />
              <span className="text-primary">estruturada por IA</span>
            </h1>
            <p className="text-muted-foreground max-w-[420px] text-[1.05rem] leading-relaxed">
              Consulte a SBC OpenLib e o OpenAlex, extraia PDFs, gere resumos automáticos e
              sintetize revisões de literatura em minutos.
            </p>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-3">
            <a
              href="/login"
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Entrar com Google
              <ArrowRight className="h-4 w-4" />
            </a>
            <span className="text-muted-foreground/60 text-xs">Acesso gratuito · SCBC</span>
          </div>

          {/* Capabilities como lista compacta */}
          <div className="border-border/60 w-full rounded-lg border bg-white/60 dark:bg-zinc-900/40">
            {[
              { icon: Search, label: 'Busca semântica', detail: 'SBC OpenLib + OpenAlex (250M+)' },
              { icon: FileText, label: 'Extração de PDFs', detail: 'TL;DR automático por paper' },
              { icon: Layers, label: 'Síntese PRISMA', detail: 'Revisão sistemática exportável' },
            ].map(({ icon: Icon, label, detail }, i) => (
              <div
                key={label}
                className={`flex items-center gap-3 px-4 py-3 ${i < 2 ? 'border-border/40 border-b' : ''}`}
              >
                <div className="bg-primary/8 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-[13px]" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-foreground text-[12px] font-semibold">{label}</p>
                  <p className="text-muted-foreground truncate font-mono text-[10px]">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Product preview ─────────────────────────────────── */}
        <div className="hidden flex-col gap-3 lg:flex">
          {/* App window mockup */}
          <div className="border-border/70 bg-card overflow-hidden rounded-xl border shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
            {/* Barra de título */}
            <div className="border-border/50 bg-muted/30 flex items-center justify-between border-b px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-2 w-2 rounded-full bg-zinc-300/80 dark:bg-zinc-600/80"
                    />
                  ))}
                </div>
                <span className="text-muted-foreground/50 font-mono text-[10px]">
                  sol-open-library / workspace
                </span>
              </div>
              <div className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[8px] text-emerald-600 uppercase dark:bg-emerald-500/10 dark:text-emerald-400">
                ao vivo
              </div>
            </div>

            {/* Chat preview */}
            <div className="space-y-3 p-4">
              {/* User msg */}
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-tr-sm px-3.5 py-2 text-[12px] font-medium">
                  IA aplicada ao ensino de engenharia no Brasil
                </div>
              </div>

              {/* Assistant response */}
              <div className="flex justify-start">
                <div className="border-border/60 bg-card max-w-[94%] space-y-2 rounded-2xl rounded-tl-sm border px-3.5 py-3">
                  <p className="text-muted-foreground/70 font-mono text-[8px] tracking-[0.2em] uppercase">
                    SOL · Assistente
                  </p>
                  <p className="text-foreground/80 text-[12px] leading-relaxed">
                    Gerei <strong>3 strings de busca</strong> para cobertura sistemática do tema.
                  </p>
                  {/* Mini proposal card */}
                  <div className="border-l-primary bg-primary/4 rounded-r-md border-l-2 p-2.5">
                    <p className="text-primary font-mono text-[8px] tracking-[0.18em] uppercase">
                      Proposta · SOL OpenLib
                    </p>
                    <p className="text-muted-foreground mt-1 line-clamp-1 font-mono text-[9px]">
                      &quot;machine learning&quot; AND &quot;engineering education&quot; AND
                      &quot;higher education&quot;
                    </p>
                  </div>
                </div>
              </div>

              {/* Artigos encontrados */}
              <div className="border-border/60 overflow-hidden rounded-lg border">
                <div className="border-border/40 bg-muted/20 flex items-center justify-between border-b px-3 py-1.5">
                  <span className="text-muted-foreground font-mono text-[8px] tracking-[0.18em] uppercase">
                    Acervo · 12 artigos
                  </span>
                  <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono text-[8px]">
                    SOL
                  </span>
                </div>
                {[
                  {
                    title: 'Applying ML to Undergraduate CS Courses',
                    year: '2023',
                    status: 'done',
                  },
                  {
                    title: 'Gamification in STEM Engineering Education',
                    year: '2022',
                    status: 'done',
                  },
                  { title: 'Deep Learning for Automated Assessment', year: '2024', status: 'proc' },
                ].map((a, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-3 py-2 ${i < 2 ? 'border-border/40 border-b' : ''}`}
                  >
                    <span className="text-foreground/70 max-w-[200px] truncate text-[10px]">
                      {a.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground/60 font-mono text-[9px]">
                        {a.year}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[8px] tracking-wide uppercase ${
                          a.status === 'done'
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-primary/8 text-primary'
                        }`}
                      >
                        {a.status === 'done' ? '✓ ok' : '···'}
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
              { value: 'SBC', label: 'OpenLib ibero-americana' },
              { value: '250M+', label: 'papers via OpenAlex' },
              { value: '< 3s', label: 'TL;DR por PDF' },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="border-border/60 bg-card rounded-lg border px-3 py-3 text-center"
              >
                <p className="text-primary font-mono text-[15px] font-bold">{value}</p>
                <p className="text-muted-foreground mt-0.5 text-[10px] leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-border/40 border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <p className="text-muted-foreground/40 font-mono text-[9px] tracking-widest uppercase">
            Sociedade Brasileira de Computação · SCBC
          </p>
          <p className="text-muted-foreground/40 font-mono text-[9px] tracking-widest uppercase">
            Open Access · MIT License
          </p>
        </div>
      </footer>
    </div>
  );
}

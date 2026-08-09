'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  UserCircle,
  Paintbrush,
  Search,
  BrainCog,
  RotateCcw,
  Sun,
  Moon,
  Mail,
  CalendarDays,
  KeyRound,
  LogOut,
  BarChart3,
  Coins,
  FileText,
  Loader2,
  Zap,
  Shield,
  ChevronRight,
  Check,
  AlertTriangle,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useTheme } from '@/components/theme-provider';
import { useUserSettings } from '@/hooks/useUserSettings';
import { UserAvatar } from './UserAvatar';
import { cn } from '@/lib/utils';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TabId = 'perfil' | 'aparencia' | 'pesquisa' | 'llms' | 'estatisticas';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: TabId;
}

// ── Navegação lateral ─────────────────────────────────────────────────────────

const NAV_ITEMS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'perfil', label: 'Minha Conta', icon: <UserCircle className="size-4" /> },
  { id: 'aparencia', label: 'Aparência', icon: <Paintbrush className="size-4" /> },
  { id: 'pesquisa', label: 'Pesquisa', icon: <Search className="size-4" /> },
  { id: 'llms', label: 'Modelos / IA', icon: <BrainCog className="size-4" /> },
  { id: 'estatisticas', label: 'Estatísticas', icon: <BarChart3 className="size-4" /> },
];

// ── Componentes compartilhados ────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-muted-foreground mb-3 text-[10.5px] font-semibold tracking-widest uppercase">
        {title}
      </h4>
      <div className="divide-border/50 border-border/50 divide-y rounded-lg border">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label className="cursor-default text-[13px] leading-none font-medium">{label}</Label>
        {description && (
          <p className="text-muted-foreground mt-1.5 text-[11.5px] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ShimmerCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-muted/30 border-border/30 rounded-lg border px-3 py-3', className)}>
      <Skeleton className="mb-2 h-3 w-16" />
      <Skeleton className="mb-1 h-5 w-20" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

function ShimmerRow() {
  return (
    <div className="flex min-h-[52px] items-center justify-between px-4 py-3">
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-8 w-20 rounded-md" />
    </div>
  );
}

function ShimmerSection() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-24" />
      <div className="rounded-lg border p-1">
        <ShimmerRow />
        <ShimmerRow />
        <ShimmerRow />
      </div>
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-12">
      <div className="bg-muted/50 flex size-10 items-center justify-center rounded-full">{icon}</div>
      <p className="text-[13px]">{message}</p>
    </div>
  );
}

// ── Aba: Minha Conta ──────────────────────────────────────────────────────────

function TabPerfil() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <div className="space-y-6">
      <Section title="Identidade">
        <div className="flex items-center gap-5 px-5 py-5">
          <UserAvatar
            src={user?.image}
            alt={user?.name ?? 'Avatar'}
            className="ring-primary/20 size-16 rounded-full ring-2 ring-offset-2 ring-offset-background"
            iconSize={32}
          />
          <div className="min-w-0 space-y-1.5">
            <p className="text-foreground truncate text-[15px] font-semibold">
              {user?.name ?? 'Pesquisador Visitante'}
            </p>
            <div className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{user?.email ?? 'Sem email vinculado'}</span>
            </div>
            <Badge variant="secondary" className="mt-1 gap-1.5 text-[10px] font-normal">
              <Sparkles className="size-2.5" />
              Membro C.O.R.E. Open
            </Badge>
          </div>
        </div>
      </Section>

      <Section title="Conta">
        <div className="px-4 py-3">
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-destructive/80 hover:text-destructive hover:bg-destructive/5 flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors"
          >
            <LogOut className="size-3.5" />
            Sair da conta
            <ChevronRight className="size-3 ml-auto opacity-50" />
          </button>
        </div>
      </Section>
    </div>
  );
}

// ── Aba: Aparência ────────────────────────────────────────────────────────────

function TabAparencia() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="space-y-6">
      <Section title="Tema">
        <SettingRow
          label={isDark ? 'Modo escuro ativo' : 'Modo claro ativo'}
          description="Alterna entre o tema claro e escuro da interface."
        >
          <Button variant="outline" size="sm" onClick={toggleTheme} className="gap-2">
            {isDark ? (
              <Sun className="size-3.5 text-amber-400" />
            ) : (
              <Moon className="size-3.5 text-slate-500" />
            )}
            {isDark ? 'Usar claro' : 'Usar escuro'}
          </Button>
        </SettingRow>
      </Section>

      <Section title="Preferências de exibição">
        <SettingRow
          label="Densidade da interface"
          description="Controla o espaçamento entre os elementos da interface."
        >
          <Select defaultValue="comfortable">
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">Compacto</SelectItem>
              <SelectItem value="comfortable">Confortável</SelectItem>
              <SelectItem value="spacious">Espaçoso</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>
    </div>
  );
}

// ── Aba: Pesquisa ─────────────────────────────────────────────────────────────

function TabPesquisa() {
  const { settings, updateSetting, resetSettings } = useUserSettings();

  const handleBrowserNotifications = async (enabled: boolean) => {
    if (enabled && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    }
    updateSetting('browserNotifications', enabled);
  };

  return (
    <div className="space-y-6">
      <Section title="Resultados">
        <SettingRow
          label="Artigos por busca"
          description="Número máximo de artigos retornados por pesquisa."
        >
          <Select
            value={String(settings.articlesPerSearch)}
            onValueChange={(v) => updateSetting('articlesPerSearch', Number(v) as 10 | 25)}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="Idioma dos TL;DRs"
          description="Idioma em que os resumos automáticos serão gerados."
        >
          <Select
            value={settings.tldrLanguage}
            onValueChange={(v) => updateSetting('tldrLanguage', v as 'pt-BR' | 'en-US' | 'es')}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
              <SelectItem value="es">Español</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>

      <Section title="Notificações">
        <SettingRow
          label="Notificação ao processar"
          description="Receber notificação do browser ao fim do processamento dos artigos."
        >
          <Switch
            checked={settings.browserNotifications}
            onCheckedChange={handleBrowserNotifications}
          />
        </SettingRow>
      </Section>

      <div className="flex justify-start pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={resetSettings}
          className="text-muted-foreground hover:text-destructive gap-1.5 px-0 text-[12px]"
        >
          <RotateCcw className="size-3" />
          Restaurar padrões
        </Button>
      </div>
    </div>
  );
}

// ── Aba: Modelos / IA ─────────────────────────────────────────────────────────

const PRESET_META: Record<string, { label: string; desc: string; icon: React.ReactNode }> = {
  economy: {
    label: 'Econômico',
    desc: 'Modelos menores, custo baixo. Ideal para buscas simples.',
    icon: <Coins className="size-4 text-emerald-500" />,
  },
  balanced: {
    label: 'Equilibrado',
    desc: 'Boa relação custo/qualidade. Recomendado para uso geral.',
    icon: <Zap className="size-4 text-amber-500" />,
  },
  quality: {
    label: 'Qualidade',
    desc: 'Modelos maiores, maior qualidade. Custo mais alto.',
    icon: <Sparkles className="size-4 text-violet-500" />,
  },
};

function TabLLMs() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState('google');
  const [preset, setPreset] = useState('balanced');
  const [models, setModels] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [useOwnKey, setUseOwnKey] = useState(false);
  const [providers, setProviders] = useState<Record<string, { label: string; models: Record<string, string[]> }>>({});
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/settings/llm');
      if (!res.ok) return;
      const data = await res.json();
      if (cancelled) return;
      setProviders(data.providers ?? {});
      if (data.settings) {
        setProvider(data.settings.provider ?? 'google');
        setPreset(data.settings.preset ?? 'balanced');
        setModels(data.settings.models ?? {});
        setUseOwnKey(Boolean(data.settings.useOwnKey));
        setHasApiKey(Boolean(data.settings.hasApiKey));
        setApiKeyLast4(data.settings.apiKeyLast4 ?? null);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const providerDef = providers[provider];

  const save = async () => {
    setSaving(true);
    setTestState('idle');
    setTestMessage(null);
    const res = await fetch('/api/settings/llm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, preset, models, useOwnKey, apiKey: apiKey || undefined }),
    });
    setSaving(false);
    if (res.ok) {
      setTestState('success');
      setTestMessage('Configuração salva com sucesso.');
      if (apiKey) {
        setHasApiKey(true);
        setApiKeyLast4(apiKey.slice(-4));
        setApiKey('');
      }
      setTimeout(() => { setTestState('idle'); setTestMessage(null); }, 3000);
    } else {
      setTestState('error');
      setTestMessage('Falha ao salvar configuração.');
    }
  };

  const test = async () => {
    setTestState('testing');
    setTestMessage(null);
    const res = await fetch('/api/settings/llm/test', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setTestState('success');
      setTestMessage(`Conexão OK — ${data.text ?? 'resposta recebida'}`);
    } else {
      setTestState('error');
      setTestMessage(`Falhou: ${data.error ?? res.status}`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <ShimmerSection />
        <ShimmerSection />
        <ShimmerSection />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Provider */}
      <Section title="Provedor ativo">
        <SettingRow label="Provedor" description="Escolha o provider usado pelas respostas e agentes.">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(providers).map(([id, p]) => (
                <SelectItem key={id} value={id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>

      {/* Preset Cards */}
      <div>
        <h4 className="text-muted-foreground mb-3 text-[10.5px] font-semibold tracking-widest uppercase">
          Perfil de modelos
        </h4>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(PRESET_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => { setPreset(key); setModels({}); }}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-all',
                preset === key
                  ? 'bg-primary/5 border-primary/30 ring-primary/20 ring-1'
                  : 'bg-muted/20 border-border/40 hover:border-border/70 hover:bg-muted/40'
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                {meta.icon}
                <span className="text-foreground text-[12px] font-semibold">{meta.label}</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">{meta.desc}</p>
              {preset === key && (
                <div className="text-primary mt-2 flex items-center gap-1 text-[10px] font-medium">
                  <Check className="size-3" />
                  Ativo
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Model Grid */}
      <Section title="Modelos em uso">
        {['orchestrator', 'synthesis', 'tldr', 'reranker', 'strategy', 'embedding'].map((task) => {
          const hasModels = providerDef?.models?.[task]?.length;
          const selected = models[task] ?? providerDef?.models?.[task]?.[0] ?? '';
          return (
            <div key={task} className="flex min-h-[52px] items-center justify-between gap-6 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Cpu className="text-muted-foreground size-3" />
                  <Label className="cursor-default text-[13px] leading-none font-medium">{task}</Label>
                </div>
                {!hasModels && (
                  <p className="text-muted-foreground mt-1 text-[11px]">Sem suporte neste provedor</p>
                )}
              </div>
              <Select
                value={selected}
                onValueChange={(value) => setModels((prev) => ({ ...prev, [task]: value }))}
                disabled={!hasModels}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Sem suporte" />
                </SelectTrigger>
                <SelectContent>
                  {(providerDef?.models?.[task] ?? []).map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </Section>

      {/* API Key */}
      <Section title="API Keys">
        <SettingRow label="Usar minha chave" description="Se desligado, usa a chave do servidor.">
          <Switch checked={useOwnKey} onCheckedChange={setUseOwnKey} />
        </SettingRow>
        <SettingRow
          label="API key"
          description={hasApiKey ? `Chave salva: ••••${apiKeyLast4}` : 'Nenhuma chave salva.'}
        >
          <div className="flex items-center gap-2">
            <KeyRound className="text-muted-foreground size-3.5" />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? '••••••••' : 'cole sua API key'}
              className="border-input bg-background h-9 w-56 rounded-md border px-3 text-sm"
            />
          </div>
        </SettingRow>

        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <Button variant="outline" size="sm" onClick={test} disabled={testState === 'testing'} className="gap-1.5">
            {testState === 'testing' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Zap className="size-3" />
            )}
            {testState === 'testing' ? 'Testando...' : 'Testar conexão'}
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>

        {/* Test Result with Animation */}
        <AnimatePresence>
          {testMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className="overflow-hidden"
            >
              <div className={cn(
                'mx-4 mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12px]',
                testState === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                testState === 'error' && 'bg-destructive/10 text-destructive',
                testState === 'testing' && 'bg-primary/10 text-primary'
              )}>
                {testState === 'success' && <Check className="size-3.5 shrink-0" />}
                {testState === 'error' && <AlertTriangle className="size-3.5 shrink-0" />}
                {testState === 'testing' && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                {testMessage}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Section>
    </div>
  );
}

// ── Tab Estatísticas ────────────────────────────────────────────────────────

const PERIOD_LABELS = { today: 'Hoje', week: 'Esta semana', month: 'Este mês' } as const;

function TabEstatisticas() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');

  const fetchStats = (p: 'today' | 'week' | 'month') => {
    setLoading(true);
    void fetch(`/api/usage/stats?scope=user&period=${p}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStats(d))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchStats(period); }, []);

  const fmtNum = (n: number) =>
    n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1_000 ? (n / 1_000).toFixed(1) + 'k' : String(n);
  const fmtUSD = (microUSD: number) =>
    microUSD === 0 ? '$0.00' : microUSD / 1_000_000 < 0.01 ? '<$0.01' : `$${(microUSD / 1_000_000).toFixed(2)}`;

  const tokenChartData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'Input', value: stats.usage.inputTokens, fill: '#6366f1' },
      { name: 'Cache', value: stats.usage.cachedTokens, fill: '#22d3ee' },
      { name: 'Output', value: stats.usage.outputTokens, fill: '#a78bfa' },
    ].filter((d) => d.value > 0);
  }, [stats]);

  const acervoChartData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'Completos', value: stats.acervo.done, fill: '#10b981' },
      { name: 'Resumo', value: stats.acervo.abstract, fill: '#f59e0b' },
      { name: 'Falhas', value: stats.acervo.failed, fill: '#ef4444' },
    ].filter((d) => d.value > 0);
  }, [stats]);

  const cachePercent = stats?.usage?.totalTokens
    ? Math.round((stats.usage.cachedTokens / stats.usage.totalTokens) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <h4 className="text-muted-foreground text-[10.5px] font-semibold tracking-widest uppercase">
          Período: {PERIOD_LABELS[period]}
        </h4>
        <div className="bg-muted/60 flex gap-0.5 rounded-lg p-0.5">
          {(['today', 'week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => { setPeriod(p); fetchStats(p); }}
              className={cn(
                'rounded-md px-3 py-1 text-[11px] font-medium transition-all',
                period === p
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ShimmerCard /><ShimmerCard /><ShimmerCard /><ShimmerCard />
          </div>
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : !stats ? (
        <EmptyState icon={<BarChart3 className="size-5" />} message="Sem dados de uso disponíveis." />
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={<FileText className="text-indigo-500 h-4 w-4" />} label="Tokens totais" value={fmtNum(stats.usage.totalTokens)} accent="indigo" />
            <StatCard icon={<Coins className="text-amber-500 h-4 w-4" />} label="Custo estimado" value={fmtUSD(stats.usage.costMicrousd)} accent="amber" />
            <StatCard label="Em cache" value={fmtNum(stats.usage.cachedTokens)} hint={`${cachePercent}%`} accent="cyan" />
            <StatCard label="Turns de chat" value={String(stats.usage.chatTurns)} accent="violet" />
          </div>

          {/* Token Distribution Chart */}
          {tokenChartData.length > 0 && (
            <div className="bg-muted/20 border-border/40 rounded-lg border p-4">
              <h4 className="text-muted-foreground mb-3 text-[10.5px] font-semibold tracking-widest uppercase">
                Distribuição de tokens
              </h4>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={tokenChartData} barSize={32}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
                    formatter={(value) => [fmtNum(Number(value)), 'tokens']}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {tokenChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Acervo */}
          <Section title="Acervo processado">
            <div className="px-4 py-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Completos" value={String(stats.acervo.done)} color="emerald" />
                <MiniStat label="Só resumo" value={String(stats.acervo.abstract)} color="amber" />
                <MiniStat label="Falhas" value={String(stats.acervo.failed)} color="red" />
              </div>
              {stats.acervo.total > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Progresso</span>
                    <span className="text-foreground font-medium">{stats.acervo.done}/{stats.acervo.total}</span>
                  </div>
                  <Progress value={(stats.acervo.done / stats.acervo.total) * 100} className="h-1.5" />
                </div>
              )}
            </div>
          </Section>

          {/* Buscas */}
          <Section title="Buscas">
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 flex size-8 items-center justify-center rounded-md">
                  <Search className="text-primary size-4" />
                </div>
                <div>
                  <span className="text-foreground block text-[13px] font-semibold">{stats.searches}</span>
                  <span className="text-muted-foreground text-[11px]">buscas executadas</span>
                </div>
              </div>
            </div>
          </Section>

          {/* Detalhes */}
          <Section title="Detalhes por evento">
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Input tokens</span>
                <span className="text-foreground font-medium tabular-nums">{fmtNum(stats.usage.inputTokens)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Output tokens</span>
                <span className="text-foreground font-medium tabular-nums">{fmtNum(stats.usage.outputTokens)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Cache hit</span>
                <span className="text-foreground font-medium tabular-nums">{fmtNum(stats.usage.cachedTokens)}</span>
              </div>
              <div className="border-border/40 my-1 h-px" />
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Modelos usados</span>
                <span className="text-foreground text-right font-medium">{stats.usage.models?.join(', ') ?? '—'}</span>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  accent = 'default',
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: 'default' | 'indigo' | 'amber' | 'cyan' | 'violet';
}) {
  const accents = {
    default: '',
    indigo: 'border-indigo-500/20 bg-indigo-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    violet: 'border-violet-500/20 bg-violet-500/5',
  };
  return (
    <div className={cn('rounded-lg border px-3.5 py-3 transition-colors', accents[accent] || 'bg-muted/30 border-border/30')}>
      {icon && <div className="mb-1.5">{icon}</div>}
      <span className="text-foreground block text-[15px] font-bold tabular-nums">{value}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[11px]">{label}</span>
        {hint && <span className="text-muted-foreground text-[10px]">({hint})</span>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    red: 'text-red-500',
  };
  return (
    <div className="text-center">
      <span className={cn('text-foreground block text-[16px] font-bold tabular-nums', colors[color])}>{value}</span>
      <span className="text-muted-foreground text-[10px]">{label}</span>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────────

const TAB_CONTENT: Record<TabId, React.ReactNode> = {
  perfil: <TabPerfil />,
  aparencia: <TabAparencia />,
  pesquisa: <TabPesquisa />,
  llms: <TabLLMs />,
  estatisticas: <TabEstatisticas />,
};

export function SettingsModal({ open, onOpenChange, defaultTab = 'perfil' }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[640px] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] sm:rounded-xl">
        <DialogTitle className="sr-only">Configurações</DialogTitle>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <nav className="bg-muted/20 border-border/50 flex w-56 shrink-0 flex-col border-r">
            <div className="border-border/50 border-b px-5 py-5">
              <span className="text-foreground text-[15px] font-semibold tracking-tight">
                Configurações
              </span>
            </div>

            <div className="flex-1 space-y-0.5 px-2 py-3">
              {NAV_ITEMS.map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[13px] transition-colors duration-100',
                    activeTab === id
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            <div className="border-border/50 border-t px-5 py-3.5">
              <span className="text-muted-foreground/40 font-mono text-[8px] tracking-widest uppercase">
                C.O.R.E. AI · v0.9-beta
              </span>
            </div>
          </nav>

          {/* Content */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="border-border/50 border-b px-8 py-5">
              <h2 className="text-foreground text-[15px] font-semibold">
                {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
              </h2>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{TAB_CONTENT[activeTab]}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
} from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useTheme } from '@/components/theme-provider';
import { useUserSettings } from '@/hooks/useUserSettings';
import { UserAvatar } from './UserAvatar';
import { cn } from '@/lib/utils';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TabId = 'perfil' | 'aparencia' | 'pesquisa' | 'llms';

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
];

// ── Separador de seção ────────────────────────────────────────────────────────

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

// ── Linha de configuração ─────────────────────────────────────────────────────

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

// ── Aba: Minha Conta ──────────────────────────────────────────────────────────

function TabPerfil() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <div className="space-y-8">
      <Section title="Identidade">
        <div className="flex items-center gap-4 px-4 py-4">
          <UserAvatar
            src={user?.image}
            alt={user?.name ?? 'Avatar'}
            className="ring-border/60 size-14 rounded-full ring-2"
            iconSize={28}
          />
          <div className="min-w-0 space-y-1">
            <p className="text-foreground truncate text-[14px] font-semibold">
              {user?.name ?? 'Pesquisador Visitante'}
            </p>
            <div className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{user?.email ?? 'Sem email vinculado'}</span>
            </div>
            <Badge variant="secondary" className="mt-1 gap-1 text-[10px] font-normal">
              <CalendarDays className="size-2.5" />
              Membro C.O.R.E. Open
            </Badge>
          </div>
        </div>
      </Section>

      <Section title="Conta">
        <div className="px-4 py-3">
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-destructive hover:bg-destructive/8 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors"
          >
            <LogOut className="size-3.5" />
            Sair da conta
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
    <div className="space-y-8">
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
    <div className="space-y-8">
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

      <div className="flex justify-start">
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

function TabLLMs() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState('google');
  const [models, setModels] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [useOwnKey, setUseOwnKey] = useState(false);
  const [providers, setProviders] = useState<Record<string, { label: string; models: Record<string, string[]> }>>({});
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

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
        setModels(data.settings.models ?? {});
        setUseOwnKey(Boolean(data.settings.useOwnKey));
        setApiKeyLast4(data.settings.apiKeyLast4 ?? null);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const providerDef = providers[provider];
  const save = async () => {
    setSaving(true);
    setTestResult(null);
    const res = await fetch('/api/settings/llm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, models, useOwnKey, apiKey: apiKey || undefined }),
    });
    setSaving(false);
    setTestResult(res.ok ? 'Configuração salva.' : 'Falha ao salvar configuração.');
    if (res.ok && apiKey) {
      setApiKeyLast4(apiKey.slice(-4));
      setApiKey('');
    }
  };

  const test = async () => {
    setTestResult('Testando...');
    const res = await fetch('/api/settings/llm/test', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setTestResult(res.ok ? `OK: ${data.text ?? ''}` : `Falhou: ${data.error ?? res.status}`);
  };

  if (loading) return <p className="text-muted-foreground text-sm">Carregando...</p>;

  return (
    <div className="space-y-8">
      <Section title="Provedor ativo">
        <SettingRow label="Provedor" description="Escolha o provider usado pelas respostas e agentes.">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(providers).map(([id, p]) => (
                <SelectItem key={id} value={id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>

      <Section title="Modelos em uso">
        {['orchestrator', 'synthesis', 'tldr', 'reranker', 'strategy', 'embedding'].map((task) => (
          <SettingRow key={task} label={task}>
            <Select
              value={models[task] ?? providerDef?.models?.[task]?.[0] ?? ''}
              onValueChange={(value) => setModels((prev) => ({ ...prev, [task]: value }))}
              disabled={!providerDef?.models?.[task]?.length}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Sem suporte" />
              </SelectTrigger>
              <SelectContent>
                {(providerDef?.models?.[task] ?? []).map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        ))}
      </Section>

      <Section title="API Keys">
        <SettingRow label="Usar minha chave" description="Se desligado, usa a chave do servidor.">
          <Switch checked={useOwnKey} onCheckedChange={setUseOwnKey} />
        </SettingRow>
        <SettingRow label="API key" description={apiKeyLast4 ? `Chave salva: ••••${apiKeyLast4}` : 'Nenhuma chave salva.'}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cole sua API key"
            className="border-input bg-background h-9 w-56 rounded-md border px-3 text-sm"
          />
        </SettingRow>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={test}>
            Testar
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar IA'}
          </Button>
        </div>
        {testResult && <p className="text-muted-foreground text-right text-xs">{testResult}</p>}
      </Section>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────────

const TAB_CONTENT: Record<TabId, React.ReactNode> = {
  perfil: <TabPerfil />,
  aparencia: <TabAparencia />,
  pesquisa: <TabPesquisa />,
  llms: <TabLLMs />,
};

export function SettingsModal({ open, onOpenChange, defaultTab = 'perfil' }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
       * Layout dois painéis:
       *   ┌──────────────┬──────────────────────────┐
       *   │  nav lateral │  conteúdo (scrollável)    │
       *   └──────────────┴──────────────────────────┘
       */}
      <DialogContent className="flex h-[640px] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] sm:rounded-xl">
        {/* Título para acessibilidade */}
        <DialogTitle className="sr-only">Configurações</DialogTitle>

        <div className="flex flex-1 overflow-hidden">
          {/* ── Sidebar de navegação ── */}
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

          {/* ── Painel de conteúdo ── */}
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

'use client';

import { SidebarTrigger } from '@/components/ui/sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Settings, Paintbrush, Search, Bell, BrainCog, RotateCcw, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useUserSettings } from '@/hooks/useUserSettings';
import { Badge } from '@/components/ui/badge';

export default function SettingsPage() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { settings, updateSetting, resetSettings } = useUserSettings();

  const handleBrowserNotifications = async (enabled: boolean) => {
    if (enabled && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
    }
    updateSetting('browserNotifications', enabled);
  };

  const handleReset = () => {
    resetSettings();
  };

  return (
    <div className="bg-background text-foreground flex h-screen flex-col font-sans">
      {/* Header */}
      <header className="border-border bg-background flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <SidebarTrigger />
        <div className="bg-border h-4 w-px" />
        <div className="flex items-center gap-2">
          <Settings className="text-primary h-4 w-4" />
          <span className="text-foreground/80 text-sm font-semibold tracking-tight">
            Configurações
          </span>
        </div>
      </header>

      {/* Conteúdo */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-6 pt-10">
        <div className="w-full max-w-xl space-y-5">
          {/* Aparência */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Paintbrush className="text-muted-foreground size-4" />
                <CardTitle className="text-base">Aparência</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">
                    {resolvedTheme === 'dark' ? 'Modo Escuro' : 'Modo Claro'}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Alterna entre o tema claro e escuro da interface.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={toggleTheme} className="gap-2">
                  {resolvedTheme === 'dark' ? (
                    <Sun className="size-4 text-amber-400" />
                  ) : (
                    <Moon className="size-4 text-slate-500" />
                  )}
                  {resolvedTheme === 'dark' ? 'Mudar para Claro' : 'Mudar para Escuro'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Pesquisa */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Search className="text-muted-foreground size-4" />
                <CardTitle className="text-base">Pesquisa</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Ajuste o comportamento padrão das buscas e da geração de resumos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Artigos por Busca</Label>
                  <p className="text-muted-foreground text-xs">
                    Número máximo de artigos retornados por pesquisa.
                  </p>
                </div>
                <Select
                  value={String(settings.articlesPerSearch)}
                  onValueChange={(v: string) =>
                    updateSetting('articlesPerSearch', Number(v) as 10 | 25)
                  }
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Idioma dos TL;DRs</Label>
                  <p className="text-muted-foreground text-xs">
                    Idioma em que os resumos automáticos serão gerados.
                  </p>
                </div>
                <Select
                  value={settings.tldrLanguage}
                  onValueChange={(v: string) =>
                    updateSetting('tldrLanguage', v as 'pt-BR' | 'en-US' | 'es')
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt-BR">Português</SelectItem>
                    <SelectItem value="en-US">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Notificações */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bell className="text-muted-foreground size-4" />
                <CardTitle className="text-base">Notificações</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Notificação ao Processar</Label>
                  <p className="text-muted-foreground text-xs">
                    Enviar notificação do browser quando todos os artigos forem processados.
                  </p>
                </div>
                <Switch
                  checked={settings.browserNotifications}
                  onCheckedChange={handleBrowserNotifications}
                />
              </div>
            </CardContent>
          </Card>

          {/* IA (informativo) */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BrainCog className="text-muted-foreground size-4" />
                <CardTitle className="text-base">Modelo de IA</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Configurações do provedor de IA são definidas pelo administrador da instância.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Provedor Ativo</span>
                <Badge variant="secondary" className="font-mono text-xs">
                  {process.env.NEXT_PUBLIC_LLM_PROVIDER ?? 'Google Gemini'}
                </Badge>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Para alterar o provedor ou o modelo padrão, edite as variáveis{' '}
                <code className="bg-muted rounded px-1">LLM_PROVIDER</code> e{' '}
                <code className="bg-muted rounded px-1">LLM_MODEL</code> no arquivo{' '}
                <code className="bg-muted rounded px-1">.env</code>.
              </p>
            </CardContent>
          </Card>

          {/* Resetar */}
          <div className="flex justify-end pb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-muted-foreground hover:text-destructive gap-2 text-xs"
            >
              <RotateCcw className="size-3" />
              Restaurar padrões
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

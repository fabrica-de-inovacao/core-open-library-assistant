# SOL Open Library Assistant — Copilot Instructions

Este arquivo é lido automaticamente pelo GitHub Copilot em toda sessão.
Seguir estas regras é **obrigatório** antes de qualquer edição no projeto.

---

## 1. Stack e versões — nunca atualizar sem análise explícita

| Pacote           | Versão em uso     | Restrição                                   |
| ---------------- | ----------------- | ------------------------------------------- |
| `next`           | 16.1.6            | PPR ativo (`cacheComponents: true`)         |
| `ai`             | 6.x               | Não atualizar — breaking changes frequentes |
| `@ai-sdk/google` | 3.x               | Não atualizar junto com `ai`                |
| `@ai-sdk/openai` | 3.x               | Idem                                        |
| `tailwindcss`    | v4                | Ver seção 3 abaixo                          |
| `radix-ui`       | latest via shadcn | Ver seção 4 abaixo                          |
| `react`          | 19                | React Compiler ativo                        |

---

## 2. Edição de arquivos — regras absolutas

- **NUNCA** usar PowerShell (`Get-Content`, `Set-Content`) para ler e reescrever arquivos com texto.
  - `Get-Content` sem `-Encoding UTF8` usa Windows-1252 por padrão e corrompe UTF-8 multibyte (ã→Ã£, ·→Â·, ─→â"€).
  - **Usar exclusivamente** as ferramentas nativas do Copilot: `replace_string_in_file`, `create_file`, `edit_notebook_file`.
  - PowerShell só é permitido para: executar builds, rodar servidores, instalar dependências.

---

## 3. Tailwind CSS v4 — diferenças críticas em relação ao v3

### 3a. `hover:` não é incondicional no v4

- **v3:** `.hover\:bg-accent:hover {}` → funciona sempre
- **v4:** `@media (hover: hover) { .hover\:bg-accent:hover {} }` → **falha em devices Windows com touchscreen** (a media query retorna `none`)
- **Correção obrigatória** já aplicada em `globals.css`:
  ```css
  @custom-variant hover (&:hover);
  ```
  Isso sobrescreve a variante para comportamento incondicional. **Nunca remover.**

### 3b. `group-hover/name:` (named group hover) é instável no v4

- Usar React state + inline styles ou `onMouseEnter`/`onMouseLeave` para visibilidade dinâmica.
- Exemplo correto (RecentChatItem): `const [hovered, setHovered] = useState(false)`.

### 3c. `@custom-variant` substitui `addVariant` do v3

- Plugin API do Tailwind v3 (`theme()`, `addBase()`, `addVariant()` em `tailwind.config`) **não existe** no v4.
- Configuração vai em `globals.css` via `@theme inline {}` e `@custom-variant`.

---

## 4. Radix UI — contrato dos componentes compostos

Radix (Tooltip, Dialog, DropdownMenu, Popover, etc.) usa **state machines internas**.
Montar/desmontar partes condicionalmente **bypassa a state machine** e causa bugs (todos os tooltips abrem ao mesmo tempo, animações quebradas, foco perdido).

### 4a. Tooltip

```tsx
// ❌ ERRADO — monta/desmonta TooltipContent condicionalmente
<Tooltip>
  <TooltipTrigger>...</TooltipTrigger>
  {condition && <TooltipContent>texto</TooltipContent>}
</Tooltip>

// ✅ CORRETO — usa prop `open` para controle programático
<Tooltip open={condition ? undefined : false}>
  <TooltipTrigger>...</TooltipTrigger>
  <TooltipContent>texto</TooltipContent>  {/* sempre montado */}
</Tooltip>
```

- `open={false}` → Radix nunca abre (controlado)
- `open={undefined}` → Radix gerencia via hover/focus (não controlado, comportamento padrão)

### 4b. DropdownMenu / ContextMenu

- `DropdownMenuContent` **sempre** fica dentro de `DropdownMenuPortal` (já feito pelo componente shadcn).
- Nunca envolver `DropdownMenuTrigger` em outro elemento que captura `pointer-events`.

### 4c. Dialog / AlertDialog

- Nunca desmonta `DialogContent` enquanto o Dialog não fechou completamente — aguardar `onOpenChange(false)` antes de remover do DOM.

---

## 5. Next.js 16 com PPR (`cacheComponents: true`)

- **NUNCA** usar `export const dynamic = 'force-dynamic'` — incompatível com `cacheComponents: true`.
  - Causa erro: `"dynamic" is not compatible with cacheComponents`.
- **Para marcar uma Server Component como runtime-dynamic:**
  ```tsx
  import { connection } from 'next/server';
  export default async function Page() {
    await connection(); // sinaliza ao PPR: não pré-renderizar
    // ...
  }
  ```
- **Para isolar sub-árvores dinâmicas em layouts:**
  ```tsx
  import { Suspense } from 'react';
  <Suspense fallback={<div style={{ width: '13rem' }} />}>
    <AppSidebar /> {/* acessa cookies — precisa de Suspense boundary */}
  </Suspense>;
  ```

---

## 6. Sidebar — restrições de layout

- **NUNCA** envolver `<Sidebar>` em um `div` com `position: relative` ou sem dimensões explícitas.
  - O `sidebar-container` interno é `position: fixed` — um wrapper sem altura colapsa para 0.
- `--sidebar-width-icon` é definido via `style` prop no `<Sidebar>`, não via CSS global.
- `SidebarExpandButton` é renderizado **fora** do `<Sidebar>` (irmão no JSX), posicionado com `position: fixed`.

---

## 7. Padrões de código obrigatórios

- Comentários de rastreabilidade: `// Fase X (P-XX): descrição`
- Respostas e comentários: **sempre em Português do Brasil**
- Hover state em componentes interativos customizados: `onMouseEnter`/`onMouseLeave` (não `hover:` do Tailwind para lógica JS)
- Hover visual (cor, bg): `hover:` do Tailwind — funciona após o fix do `@custom-variant`

---

## 8. Checklist antes de qualquer edição de UI

- [ ] Estou usando algum `@custom-variant` / `hover:` corretamente para Tailwind v4?
- [ ] Estou montando/desmontando condicionalmente algum filho de componente Radix? → Usar `open` prop
- [ ] Estou usando `export const dynamic` em algum arquivo? → Substituir por `connection()`
- [ ] Estou editando com ferramenta nativa (não PowerShell de I/O)?
- [ ] O arquivo editado continua em UTF-8 sem caracteres corrompidos?

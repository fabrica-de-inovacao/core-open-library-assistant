import { Inngest, EventSchemas } from 'inngest';

// ─────────────────────────────────────────────────────────────────────────────
// Schema tipado de todos os eventos Inngest do projeto.
// Benefícios:
//   • TypeScript valida event.data nos handlers sem cast manual (as { … })
//   • inngest.send() falha em compilação se o payload estiver errado
//   • Renomear um campo quebra o build imediatamente (não em runtime)
// ─────────────────────────────────────────────────────────────────────────────
type InngestEvents = {
  /** Batch de artigos a processar — disparado pela rota de busca. */
  'app/process.articles.batch': {
    data: {
      article_ids: string[];
      query_id: string;
      tldr_lang?: string;
      /** ID do usuário autenticado, ou 'anonymous' para usuários sem sessão. */
      user_id: string;
    };
  };

  /** Pipeline completo de um único artigo — gerado pelo fan-out do orquestrador. */
  'app/process.single.article': {
    data: {
      article_id: string;
      query_id: string;
      tldr_lang?: string;
      /** ID do usuário autenticado, ou 'anonymous' para usuários sem sessão. */
      user_id: string;
    };
  };

  /** Cancela todos os jobs pendentes de uma query. */
  'app/search.cancelled': {
    data: {
      query_id: string;
    };
  };
};

export const inngest = new Inngest({
  id: 'sol-assistant',
  schemas: new EventSchemas().fromRecord<InngestEvents>(),
});

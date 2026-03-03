import { connection } from 'next/server';
import WorkspacePage from '@/app/workspace/page';
import { getChatMessages } from '@/server/actions/chat';

/**
 * Fase 1 (P-01): Rota principal do workspace ancorada em chatId.
 * O chatId é o identificador estável da sessão de chat inteira —
 * não muda quando o usuário inicia uma nova busca dentro da mesma sessão.
 *
 * URL: /workspace/chat/[chatId]
 * (substitui /workspace/query/[id] que ancorava em queryId)
 */
export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  // Sinaliza ao PPR que esta rota precisa de dados do request (não cacheavel)
  await connection();

  const resolvedParams = await params;
  const messages = await getChatMessages(resolvedParams.chatId);
  console.log(
    `[ChatPage chatId=${resolvedParams.chatId}] Retrieved ${messages.length} messages from DB.`,
    messages.map((m) => m.id)
  );
  return <WorkspacePage initialMessages={messages} />;
}

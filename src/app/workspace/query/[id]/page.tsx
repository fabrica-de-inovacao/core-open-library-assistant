import WorkspacePage from '@/app/workspace/page';
import { getChatMessages } from '@/server/actions/chat';

export default async function QueryPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const messages = await getChatMessages(resolvedParams.id);
  console.log(
    `[QueryPage ID=${resolvedParams.id}] Retrieved ${messages.length} messages from DB.`,
    messages.map((m) => m.id)
  );
  return <WorkspacePage initialMessages={messages} />;
}

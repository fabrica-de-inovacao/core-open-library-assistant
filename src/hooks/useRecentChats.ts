import { useState, useCallback, useEffect } from 'react';
import {
  getRecentChats,
  renameChatSession,
  deleteChatSession,
  type RecentChat,
} from '@/server/actions/chat';

export function useRecentChats(userId: string | undefined, pathname?: string) {
  const [chats, setChats] = useState<RecentChat[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setChats(await getRecentChats(userId, 10));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Carga inicial quando userId fica disponível
  useEffect(() => {
    load();
  }, [load]);

  // Fase 7 (P-recents): recarrega sempre que o pathname muda — garante que novas
  // sessões aparecem na sidebar assim que o utilizador navega para elas.
  useEffect(() => {
    if (!pathname || !userId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const rename = useCallback(
    async (chatId: string, title: string) => {
      if (!userId) return;
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
      await renameChatSession(chatId, userId, title);
    },
    [userId]
  );

  const remove = useCallback(
    async (chatId: string) => {
      if (!userId) return;
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      await deleteChatSession(chatId, userId);
      await load();
    },
    [userId, load]
  );

  return { chats, isLoading, rename, remove, refresh: load };
}

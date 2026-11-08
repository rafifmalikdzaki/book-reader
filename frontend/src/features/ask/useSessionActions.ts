import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createChatProject,
  deleteChatProject,
  deleteChatSession,
  updateChatSession,
} from '../../api/endpoints';
import type { ChatSession, ChatSessionPatch } from '../../api/types';
import { SESSIONS_KEY, SESSION_PREFIX, sessionKey } from './keys';

interface Args {
  session: ChatSession | undefined;
  onError: (message: string) => void;
}

/** Pin / project / category patches plus project and chat deletion (ask.js handlers). */
export function useSessionActions({ session, onError }: Args) {
  const client = useQueryClient();
  const refreshList = () => client.invalidateQueries({ queryKey: SESSIONS_KEY });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChatSessionPatch }) =>
      updateChatSession(id, body),
    onSuccess: async (updated) => {
      client.setQueryData(sessionKey(updated.id), updated);
      await refreshList();
    },
    onError: (error) => onError(error.message),
  });

  const update = (body: ChatSessionPatch) => {
    if (session) patch.mutate({ id: session.id, body });
  };

  return {
    /** Only a category change locks the controls, like ask.js `scopeBusy`. */
    scopeBusy: patch.isPending && patch.variables !== undefined && 'categories' in patch.variables.body,
    setCategories: (categories: string[]) => update({ categories }),
    togglePin: () => session && update({ pinned: !session.pinned }),
    setProject: (projectId: string) => update({ project_id: projectId || null }),
    async addProject(name: string): Promise<boolean> {
      try {
        await createChatProject(name);
        await refreshList();
        return true;
      } catch (error) {
        onError(error instanceof Error ? error.message : 'The request failed.');
        return false;
      }
    },
    async removeProject(id: string): Promise<void> {
      await deleteChatProject(id);
      await client.invalidateQueries({ queryKey: SESSION_PREFIX });
      await refreshList();
    },
    /** `onDeleted` leaves the chat first, so the open-session query never refetches a 404. */
    async removeChat(id: string, onDeleted: () => void): Promise<void> {
      await deleteChatSession(id);
      onDeleted();
      // Stale, not removed: an observer still on this key must not refetch the 404 mid-navigation.
      await client.invalidateQueries({ queryKey: sessionKey(id), refetchType: 'none' });
      await refreshList();
    },
  };
}

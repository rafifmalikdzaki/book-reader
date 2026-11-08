import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import type { NotepadNoteBody } from '../../api/types';
import { usePanels } from '../../ui';

/**
 * What a reader hands to `compose`: the captured selection and where it came from
 * (`pdf_reader.js` sends book/kind/page/quote; the Markdown reader adds section/paragraph).
 */
export type NoteDraft = Omit<NotepadNoteBody, 'group' | 'comment'>;

export const NOTEPAD_KEY = ['notepad'] as const;

interface ActiveDraft {
  note: NoteDraft;
  /** Remounts the compose form for each new capture. */
  seq: number;
  /** Route the capture came from; a navigation drops it, like the legacy page load. */
  pathname: string;
}

interface NotepadContextValue {
  draft: ActiveDraft | null;
  compose: (draft: NoteDraft) => void;
  cancel: () => void;
  refresh: () => void;
}

const NotepadContext = createContext<NotepadContextValue | null>(null);

export function NotepadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { open } = usePanels();
  const { pathname } = useLocation();
  const [stored, setStored] = useState<ActiveDraft | null>(null);

  const compose = useCallback(
    (note: NoteDraft) => {
      setStored((previous) => ({
        note,
        seq: (previous?.seq ?? 0) + 1,
        pathname,
      }));
      open('notepad');
    },
    [open, pathname],
  );
  const cancel = useCallback(() => setStored(null), []);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: NOTEPAD_KEY });
  }, [queryClient]);

  const draft = stored && stored.pathname === pathname ? stored : null;
  const value = useMemo(
    () => ({ draft, compose, cancel, refresh }),
    [draft, compose, cancel, refresh],
  );
  return <NotepadContext.Provider value={value}>{children}</NotepadContext.Provider>;
}

function useNotepadContext(): NotepadContextValue {
  const value = useContext(NotepadContext);
  if (!value) throw new Error('Notepad hooks must be used inside <NotepadProvider>');
  return value;
}

/** Replaces `window.Notepad`: `compose` opens the notes rail with a new note form. */
export function useNotepad(): { compose: (draft: NoteDraft) => void; refresh: () => void } {
  const { compose, refresh } = useNotepadContext();
  return useMemo(() => ({ compose, refresh }), [compose, refresh]);
}

/** Notepad-internal: the pending capture and a way to drop it. */
export function useNotepadDraft(): Pick<NotepadContextValue, 'draft' | 'cancel'> {
  const { draft, cancel } = useNotepadContext();
  return { draft, cancel };
}

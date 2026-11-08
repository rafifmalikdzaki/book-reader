import { useCallback, useState } from 'react';

import { readStorage, writeStorage } from '../../app/storage';

export type LibraryView = 'tiles' | 'list';

export const VIEW_KEY = 'br-view';

/** Initialised synchronously from storage so the first paint already has the right view. */
export function useLibraryView(): [LibraryView, (view: LibraryView) => void] {
  const [view, setView] = useState<LibraryView>(() =>
    readStorage(VIEW_KEY) === 'list' ? 'list' : 'tiles',
  );
  const choose = useCallback((next: LibraryView) => {
    setView(next);
    writeStorage(VIEW_KEY, next);
  }, []);
  return [view, choose];
}

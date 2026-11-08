import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** The book a reader is showing; read by the notepad and the reader chat rail. */
export interface BookContextData {
  /** Book `rel` path. */
  book: string;
  /** Current PDF page; omit or null for Markdown. */
  page?: number | null;
}

export interface BookContextValue {
  book: string | null;
  page: number | null;
  /**
   * Readers call this on mount and when the page changes, and `null` on unmount.
   * Replaces `window.BookContext` + the `book-context-changed` event.
   */
  setBookContext: (context: BookContextData | null) => void;
}

interface State {
  book: string | null;
  page: number | null;
}

const EMPTY: State = { book: null, page: null };

const ValueContext = createContext<State>(EMPTY);
const SetterContext = createContext<BookContextValue['setBookContext'] | null>(null);

export function BookContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const setBookContext = useCallback((context: BookContextData | null) => {
    const next: State = context ? { book: context.book, page: context.page ?? null } : EMPTY;
    // Same book and page: keep the old object so consumers do not re-render.
    setState((previous) =>
      previous.book === next.book && previous.page === next.page ? previous : next,
    );
  }, []);
  return (
    <SetterContext.Provider value={setBookContext}>
      <ValueContext.Provider value={state}>{children}</ValueContext.Provider>
    </SetterContext.Provider>
  );
}

/** Stable setter only; does not re-render when the context changes. */
export function useSetBookContext(): BookContextValue['setBookContext'] {
  const setter = useContext(SetterContext);
  if (!setter) throw new Error('useSetBookContext must be used inside <BookContextProvider>');
  return setter;
}

export function useBookContext(): BookContextValue {
  const { book, page } = useContext(ValueContext);
  const setBookContext = useSetBookContext();
  return useMemo(() => ({ book, page, setBookContext }), [book, page, setBookContext]);
}

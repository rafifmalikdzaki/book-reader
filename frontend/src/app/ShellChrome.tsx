import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** Per-page stage treatment: pdf and ask are full-bleed, md keeps the padded default. */
export type Stage = 'pdf' | 'ask' | 'md';

interface ChromeContextValue {
  stage: Stage | null;
  setStage: (stage: Stage | null) => void;
  contentsAvailable: boolean;
  setContentsAvailable: (available: boolean) => void;
  contentsHost: HTMLElement | null;
  setContentsHost: (host: HTMLElement | null) => void;
}

const ChromeContext = createContext<ChromeContextValue | null>(null);

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [contentsAvailable, setContentsAvailable] = useState(false);
  const [contentsHost, setContentsHost] = useState<HTMLElement | null>(null);
  const value = useMemo(
    () => ({ stage, setStage, contentsAvailable, setContentsAvailable, contentsHost, setContentsHost }),
    [stage, contentsAvailable, contentsHost],
  );
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

/** Shell-internal view of the chrome state (masthead and stage read it). */
export function useChromeState(): ChromeContextValue {
  const value = useContext(ChromeContext);
  if (!value) throw new Error('Shell chrome hooks must be used inside <ShellChromeProvider>');
  return value;
}

/**
 * A page declares its stage: `useStage('pdf')` on PDF readers, `'ask'` on /ask,
 * `'md'` on Markdown readers. Applied before paint and cleared on unmount.
 */
export function useStage(stage: Stage): void {
  const { setStage } = useChromeState();
  useLayoutEffect(() => {
    setStage(stage);
    return () => setStage(null);
  }, [stage, setStage]);
}

/**
 * Lets a page tell the shell it owns a `contents` rail, so the masthead shows the
 * phone-width Outline toggle. `<ContentsPortal>` registers this automatically.
 */
export function useShellChrome(): {
  contentsAvailable: boolean;
  setContentsAvailable: (available: boolean) => void;
} {
  const { contentsAvailable, setContentsAvailable } = useChromeState();
  return { contentsAvailable, setContentsAvailable };
}

/**
 * Renders a left rail (the Markdown outline) as a flex child of the workspace, before the
 * stage, and registers the page as having contents. Use `usePanel('contents')` for the rail.
 */
export function ContentsPortal({ children }: { children: ReactNode }) {
  const { contentsHost, setContentsAvailable } = useChromeState();
  useLayoutEffect(() => {
    setContentsAvailable(true);
    return () => setContentsAvailable(false);
  }, [setContentsAvailable]);
  return contentsHost ? createPortal(children, contentsHost) : null;
}

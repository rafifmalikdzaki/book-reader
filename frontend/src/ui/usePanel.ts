import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/** Shared "only one rail open at a time" state; see PanelProvider. */
export interface PanelApi {
  /** Id of the open panel, or null. */
  openId: string | null;
  isOpen: (id: string) => boolean;
  /** Opens `id`, closing any other panel silently and remembering the focus to restore. */
  open: (id: string) => void;
  /** Closes `id` (or whichever is open). Restores focus unless `silent`. */
  close: (id?: string, options?: { silent?: boolean }) => void;
  toggle: (id: string) => void;
}

export const PanelContext = createContext<PanelApi | null>(null);

/** Raw panel registry. Prefer `usePanel(id)` in components. */
export function usePanels(): PanelApi {
  const api = useContext(PanelContext);
  if (!api) throw new Error('usePanels must be used inside <PanelProvider>');
  return api;
}

export interface UsePanelOptions {
  /** Runs when the panel goes closed -> open (legacy `panel-open` event). */
  onOpen?: () => void;
}

export interface PanelHandle {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  /** Spread on the toggle button. */
  toggleProps: {
    'aria-controls': string;
    'aria-expanded': boolean;
    onClick: () => void;
  };
  /** Spread on `<Rail>`. */
  railProps: { id: string; open: boolean; onClose: () => void };
}

export function usePanel(id: string, options: UsePanelOptions = {}): PanelHandle {
  const { openId, open, close, toggle } = usePanels();
  const isOpen = openId === id;

  const onOpen = useRef(options.onOpen);
  useEffect(() => {
    onOpen.current = options.onOpen;
  });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) onOpen.current?.();
    wasOpen.current = isOpen;
  }, [isOpen]);

  const show = useCallback(() => open(id), [open, id]);
  const hide = useCallback(() => close(id), [close, id]);
  const flip = useCallback(() => toggle(id), [toggle, id]);

  return {
    open: isOpen,
    show,
    hide,
    toggle: flip,
    toggleProps: { 'aria-controls': id, 'aria-expanded': isOpen, onClick: flip },
    railProps: { id, open: isOpen, onClose: hide },
  };
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { MOBILE_QUERY, useMediaQuery } from './useMediaQuery';
import { PanelContext, type PanelApi } from './usePanel';

/** Overlay widgets own Esc while focus is inside them. */
const OWN_ESCAPE = '[role="dialog"], [role="listbox"], [role="menu"]';
const TOGGLE_IDS: Record<string, string> = {
  notepad: 'notepad-toggle',
  chat: 'chat-toggle',
};

/**
 * Port of shell.js open/close/toggle: one rail open at a time, focus restored to the
 * opener on a non-silent close, Esc closes, and `body.panel-open` is set on phones.
 */
export function PanelProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const mobile = useMediaQuery(MOBILE_QUERY);

  const open = useCallback((id: string) => {
    if (current.current === id) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) lastFocus.current = active;
    current.current = id;
    setOpenId(id);
  }, []);

  const close = useCallback((id?: string, options?: { silent?: boolean }) => {
    if (current.current === null || (id !== undefined && id !== current.current)) return;
    const closing = current.current;
    current.current = null;
    setOpenId(null);
    const previous = lastFocus.current;
    lastFocus.current = null;
    if (options?.silent) return;
    const toggleId = TOGGLE_IDS[closing];
    const toggle = toggleId ? document.getElementById(toggleId) : null;
    const fallback = toggle ?? document.getElementById('main');
    const target =
      previous && document.contains(previous) && !previous.closest('[hidden]')
        ? previous
        : fallback;
    target?.focus({ preventScroll: true });
  }, []);

  const toggle = useCallback(
    (id: string) => (current.current === id ? close(id) : open(id)),
    [open, close],
  );

  useEffect(() => {
    document.body.classList.toggle('panel-open', openId !== null && mobile);
    return () => document.body.classList.remove('panel-open');
  }, [openId, mobile]);

  useEffect(() => {
    if (openId === null) return;
    const panel = document.getElementById(openId);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest(OWN_ESCAPE) &&
        !panel?.contains(event.target)
      ) {
        return;
      }
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openId, close]);

  const api = useMemo<PanelApi>(
    () => ({ openId, isOpen: (id) => openId === id, open, close, toggle }),
    [openId, open, close, toggle],
  );
  return <PanelContext.Provider value={api}>{children}</PanelContext.Provider>;
}

import { useCallback, useEffect, useState } from 'react';

import { MOBILE_QUERY, useMediaQuery } from '../../ui';

/**
 * Off-canvas sessions drawer (<= 900px): Esc closes, focus moves in and returns to the menu.
 * Elements are tracked in state (callback refs), so the controls are plain render-safe values.
 */
export function useDrawer() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [requested, setRequested] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [close, setClose] = useState<HTMLElement | null>(null);
  const open = requested && isMobile;

  const show = useCallback(() => setRequested(true), []);
  const hide = useCallback(() => {
    setRequested(false);
    if (open) menu?.focus();
  }, [open, menu]);

  useEffect(() => {
    if (!open) return undefined;
    close?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, hide]);

  return { open, isMobile, show, hide, attachMenu: setMenu, attachClose: setClose };
}

export type Drawer = ReturnType<typeof useDrawer>;

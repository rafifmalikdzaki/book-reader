import { useSyncExternalStore } from 'react';

/** Legacy breakpoints (see tokens.css): phone/tablet at 900px. */
export const MOBILE_QUERY = '(max-width: 900px)';
export const DESKTOP_QUERY = '(min-width: 901px)';

function supported(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** Live `matchMedia` result; false where matchMedia is unavailable (SSR, bare jsdom). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (!supported()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => (supported() ? window.matchMedia(query).matches : false),
    () => false,
  );
}

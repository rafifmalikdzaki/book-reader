import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

import { lineAnchor, parseLineHash } from './selection';

/**
 * Scrolls to the block for `#L<n>` on load and on every navigation. Router pushes (a note
 * or citation for the open book) never fire `hashchange`, so this follows `useLocation`;
 * `key` also re-fires when the same hash is navigated to again.
 */
export function useLineDeepLink(article: RefObject<HTMLElement | null>, html: string): void {
  const { hash, key } = useLocation();
  useEffect(() => {
    const target = parseLineHash(hash);
    const root = article.current;
    if (target === null || !root) return;
    lineAnchor(root, target)?.scrollIntoView();
  }, [article, html, hash, key]);
}

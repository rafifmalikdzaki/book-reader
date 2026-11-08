import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface LibrarySearchParams {
  /** Trimmed search term from `?q=`; "" when absent. */
  q: string;
  /** `?inside=1`: search inside books (full text) instead of filtering titles. */
  inside: boolean;
}

/**
 * Global search contract (replaces the legacy `library-search` event). The masthead input
 * writes the URL; the library route reads it:
 *
 * - typing on `/` debounces 200 ms, then replaces `?q=<term>` (and drops `inside`): filter titles;
 * - Enter on `/` sets `?q=<term>&inside=1` at once: run the full-text search;
 * - Enter on any other route navigates to `/?q=<term>&inside=1`;
 * - an empty term removes both params.
 *
 * `q` is only meaningful on `/`. The hook reads whatever the current URL says.
 */
export function useLibrarySearchParams(): LibrarySearchParams {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const inside = params.get('inside') === '1';
  return useMemo(() => ({ q, inside }), [q, inside]);
}

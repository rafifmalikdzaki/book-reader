import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { search } from '../../api/endpoints';

export const SEARCH_LIMIT = 20;

/** Full-text library search behind the dock; idle unless `term` is set. */
export function useInsideSearch(term: string, active: boolean) {
  const query = useQuery({
    queryKey: ['library-search', term],
    queryFn: ({ signal }) => search(term, { limit: SEARCH_LIMIT }, { signal }),
    enabled: active && term !== '',
    retry: false,
    staleTime: 30_000,
  });
  const error = query.error;
  // 503 carries the server's "library search unavailable" reason in `detail`.
  const message = error ? (error instanceof ApiError ? error.detail : error.message) : '';
  return { query, errorMessage: error ? message || 'Search failed' : '' };
}

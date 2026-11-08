import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { getLibrary } from '../../api/endpoints';
import type { LibraryResponse } from '../../api/types';

export const LIBRARY_KEY = ['library'] as const;
const NOTICE_KEY = ['library', 'notice'] as const;

/**
 * `GET /api/library` reindexes and consumes the one-time relocation notice. It is not
 * refetched on focus or by age, but every mount refreshes it so progress and notes written
 * by a reader are visible immediately. The request is not aborted on unmount because the
 * server consumes the notice before responding; a remount must still be able to show it.
 */
export function useLibraryData() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => getLibrary(),
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const notice = useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () => client.getQueryData<string>(NOTICE_KEY) ?? '',
  );

  useEffect(() => {
    const text = query.data?.relocation_notice;
    if (!text || client.getQueryData<string>(NOTICE_KEY) === text) return;
    // Keep the one-time notice outside the refetching library payload so a remount can
    // still show it after the server has already consumed it.
    client.setQueryData(NOTICE_KEY, text);
  }, [client, query.data]);

  const dismissNotice = useCallback(() => {
    client.setQueryData(NOTICE_KEY, '');
    // Blank the payload too, so a remount before the next fetch does not resurrect it.
    client.setQueryData<LibraryResponse>(LIBRARY_KEY, (data) =>
      data ? { ...data, relocation_notice: '' } : data,
    );
  }, [client]);

  return { query, notice, dismissNotice };
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { ApiError } from '../../api/client';
import { getOrganizeStatus, startOrganize } from '../../api/endpoints';
import type { OrganizeStatus } from '../../api/types';
import { LIBRARY_KEY } from './useLibraryData';

export const ORGANIZE_KEY = ['organize', 'status'] as const;
export const ORGANIZE_POLL_MS = 1500;

export interface OrganizeApi {
  status: OrganizeStatus;
  running: boolean;
  /** Start request in flight. */
  starting: boolean;
  /** Message from a failed start request (409 already running, 503 unconfigured, ...). */
  startError: string;
  start: () => Promise<boolean>;
  clearStartError: () => void;
}

/**
 * Auto-organize state. The library payload seeds the status (no mount fetch); polling runs
 * only while the server reports `running`, and finishing with phase "done" invalidates the
 * library (replaces the legacy `location.reload()`).
 */
export function useOrganize(initial: OrganizeStatus, bookCount: number): OrganizeApi {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ORGANIZE_KEY,
    queryFn: ({ signal }) => getOrganizeStatus({ signal }),
    initialData: initial,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.running ? ORGANIZE_POLL_MS : false),
  });
  const status = data;

  const sawRunning = useRef(Boolean(initial.running));
  useEffect(() => {
    if (status.running) {
      sawRunning.current = true;
    } else if (sawRunning.current) {
      sawRunning.current = false;
      if (status.phase === 'done') void client.invalidateQueries({ queryKey: LIBRARY_KEY });
    }
  }, [status, client]);

  const mutation = useMutation({
    mutationFn: () => startOrganize({ confirm: true }),
    onSuccess: (response) => {
      client.setQueryData<OrganizeStatus>(
        ORGANIZE_KEY,
        response.status ?? { available: true, running: true, done: 0, total: bookCount },
      );
    },
  });

  const start = async (): Promise<boolean> => {
    try {
      await mutation.mutateAsync();
      return true;
    } catch {
      return false;
    }
  };

  const failure = mutation.error;
  let startError = '';
  if (failure) {
    startError = failure instanceof ApiError ? failure.detail : failure.message;
    startError ||= 'Could not start sorting';
  }

  return {
    status,
    running: Boolean(status.running),
    starting: mutation.isPending,
    startError,
    start,
    clearStartError: mutation.reset,
  };
}

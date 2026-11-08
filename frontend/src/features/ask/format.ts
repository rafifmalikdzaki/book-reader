import type { ChatStatus } from '../../api/types';

export const EXPIRED_NOTICE = 'This chat expired or was deleted.';
export const OPEN_FAILED_NOTICE = 'That chat could not be opened.';

export function baseName(rel: string | null | undefined): string {
  return String(rel ?? '').split('/').pop() ?? '';
}

/** Compact age of a session ("now", "5m", "3h", "2d", then a short date). */
export function updatedLabel(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, now / 1000 - Number(timestamp || 0));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function subtitleText(
  book: string | null | undefined,
  page: number | null | undefined,
): string {
  if (!book) return 'Library-wide · RAG';
  return `${baseName(book)}${page ? ` · p.${page}` : ''} · RAG`;
}

/** Footer status line (port of ask.js `loadStatus`). */
export function statusText(status: ChatStatus | undefined, failed: boolean): string {
  if (failed) return 'Chat status unavailable.';
  if (!status) return 'Ready · RAG';
  if (!status.available) return status.reason || 'Chat is not configured — add a provider key.';
  const selected = status.selected || 'auto';
  return selected === 'auto' ? 'Ready · RAG · Auto model' : `Ready · RAG · ${selected}`;
}

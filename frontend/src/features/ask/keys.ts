/** Query keys live under `['chat']` so a model change (which invalidates it) refreshes them. */
export const SESSIONS_KEY = ['chat', 'sessions'] as const;
export const SESSION_PREFIX = ['chat', 'session'] as const;

export function sessionKey(id: string): readonly [string, string, string] {
  return ['chat', 'session', id];
}

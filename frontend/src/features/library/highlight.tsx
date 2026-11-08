import type { ReactNode } from 'react';

/**
 * Splits `text` around case-insensitive occurrences of `term` and wraps them in `<mark>`.
 * Everything is a React text node, so markup inside a server snippet is shown, never parsed.
 */
export function highlight(text: string, term: string): ReactNode[] {
  const needle = term.toLowerCase();
  if (!needle) return [text];
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  let found = lower.indexOf(needle);
  while (found >= 0) {
    if (found > at) parts.push(text.slice(at, found));
    parts.push(<mark key={found}>{text.slice(found, found + needle.length)}</mark>);
    at = found + needle.length;
    found = lower.indexOf(needle, at);
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

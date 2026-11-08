import type { ChatSource } from '../../api/types';

/** Links in model output must be http(s), an absolute path (not `//host` or `/\\host`), or a fragment. */
export const SAFE_HREF = /^(https?:\/\/|\/(?!\/|\\)|#)/i;

/** Routes the SPA owns; only these are worth a client-side `<Link>`. */
const INTERNAL_HREF = /^\/(?:$|book(?:[/?#]|$)|ask(?:[/?#]|$))/;

export function isInternalHref(href: string): boolean {
  return INTERNAL_HREF.test(href);
}

/** `/book/<encoded path>` plus `#p<page>` or `#L<line>` (same as legacy ChatRender.bookHref). */
export function bookHref(source: ChatSource): string {
  const base = `/book/${String(source.book ?? '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  if (source.page) return `${base}#p${source.page}`;
  if (source.line) return `${base}#L${source.line}`;
  return base;
}

/** "file.pdf · p.12 · § Section" or "notes.md · lines 40–44" (same as legacy sourceLabel). */
export function sourceLabel(source: ChatSource): string {
  const parts: string[] = [String(source.book ?? '').split('/').pop() ?? ''];
  if (source.page) parts.push(`p.${source.page}`);
  if (source.line) {
    const end = source.line_end && source.line_end !== source.line ? `–${source.line_end}` : '';
    parts.push(`lines ${source.line}${end}`);
  }
  if (source.section) parts.push(`§ ${source.section}`);
  return parts.filter(Boolean).join(' · ');
}

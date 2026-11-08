/** `/book/<rel>` links, encoded like the legacy template's `rel|urlencode` (slashes kept). */
export function bookPath(rel: string): string {
  return '/book/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** Deep-link hash: `#p<page>` for PDFs, `#L<line>` for Markdown lines, else none. */
export function locatorHash(page: number | null | undefined, line?: number | null): string {
  if (page) return `#p${page}`;
  if (line) return `#L${line}`;
  return '';
}

export function bookHref(
  rel: string,
  page: number | null | undefined,
  line?: number | null,
): string {
  return bookPath(rel) + locatorHash(page, line);
}

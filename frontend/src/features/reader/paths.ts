/** `/book/<rel>` router path with each segment percent-encoded once. */
export function bookRoutePath(rel: string): string {
  return '/book/' + rel.split('/').map(encodeURIComponent).join('/');
}

/**
 * The library-relative path from the router splat. React Router already percent-decodes
 * the splat once (like FastAPI's `{rel:path}`), so it is used as is.
 */
export function relFromSplat(splat: string | undefined): string {
  return splat ?? '';
}

/** `?page=` as a positive integer, else undefined (the server clamps and ignores junk). */
export function pageFromSearch(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('page');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const page = Number(raw);
  return page > 0 ? page : undefined;
}

import type { LibraryBook, LibraryGroup } from '../../api/types';
import type { BookMeta } from './useBookMeta';

/** How the tile view is sectioned: server categories, or facets derived from metadata. */
export type GroupBy = 'category' | 'tag' | 'collection';

export const GROUP_KEY = 'br-group';

const REST_LABEL: Record<Exclude<GroupBy, 'category'>, string> = {
  tag: 'Untagged',
  collection: 'Not in a collection',
};

/**
 * Groups books by one facet (tags or Zotero collections). A book with several values goes
 * under the one shared by the most books, so a shelf forms around the common theme instead
 * of one group per rare keyword. Largest group first; books with no value come last.
 */
export function groupByFacet(
  books: LibraryBook[],
  facet: Exclude<GroupBy, 'category'>,
  metaFor: (rel: string) => BookMeta,
): LibraryGroup[] {
  const valuesOf = (book: LibraryBook) =>
    facet === 'tag' ? metaFor(book.rel).tags : metaFor(book.rel).collections;

  const names = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const book of books) {
    for (const value of valuesOf(book)) {
      const key = value.toLowerCase();
      if (!names.has(key)) names.set(key, value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const grouped = new Map<string, LibraryBook[]>();
  const rest: LibraryBook[] = [];
  for (const book of books) {
    const keys = valuesOf(book).map((value) => value.toLowerCase());
    if (keys.length === 0) {
      rest.push(book);
      continue;
    }
    const best = [...keys].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
    )[0] as string;
    grouped.set(best, [...(grouped.get(best) ?? []), book]);
  }

  const groups: LibraryGroup[] = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, members]) => ({ id: `${facet}:${key}`, name: names.get(key) ?? key, books: members }));
  if (rest.length > 0) groups.push({ id: `${facet}:`, name: REST_LABEL[facet], books: rest });
  return groups;
}

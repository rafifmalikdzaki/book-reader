import type { LibraryBook, LibraryGroup } from '../../api/types';

export interface BookFilter {
  /** Raw search term; trimmed and lowercased here. */
  term: string;
  /** Category id, "" for all categories. */
  category: string;
}

/**
 * Legacy `applyFilter`: the term must occur in "title category-id shelf" (case-insensitive),
 * and the category, when chosen, must match exactly.
 */
export function matchesBook(
  book: LibraryBook,
  { term, category }: BookFilter,
  extra = '',
): boolean {
  const needle = term.trim().toLowerCase();
  if (category && book.category_id !== category) return false;
  if (!needle) return true;
  return `${book.title} ${book.category_id} ${book.shelf} ${extra}`.toLowerCase().includes(needle);
}

/** `extraText` adds searchable words per book (authors, tags) beyond the server row. */
export function filterBooks(
  books: LibraryBook[],
  filter: BookFilter,
  extraText?: (rel: string) => string,
): LibraryBook[] {
  return books.filter((book) => matchesBook(book, filter, extraText?.(book.rel)));
}

/** Groups keep their order; groups left with no visible book are dropped. */
export function filterGroups(
  groups: LibraryGroup[],
  filter: BookFilter,
  extraText?: (rel: string) => string,
): LibraryGroup[] {
  return groups
    .map((group) => ({ ...group, books: filterBooks(group.books, filter, extraText) }))
    .filter((group) => group.books.length > 0);
}

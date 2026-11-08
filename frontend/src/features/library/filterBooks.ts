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
export function matchesBook(book: LibraryBook, { term, category }: BookFilter): boolean {
  const needle = term.trim().toLowerCase();
  if (category && book.category_id !== category) return false;
  if (!needle) return true;
  return `${book.title} ${book.category_id} ${book.shelf}`.toLowerCase().includes(needle);
}

export function filterBooks(books: LibraryBook[], filter: BookFilter): LibraryBook[] {
  return books.filter((book) => matchesBook(book, filter));
}

/** Groups keep their order; groups left with no visible book are dropped. */
export function filterGroups(groups: LibraryGroup[], filter: BookFilter): LibraryGroup[] {
  return groups
    .map((group) => ({ ...group, books: filterBooks(group.books, filter) }))
    .filter((group) => group.books.length > 0);
}

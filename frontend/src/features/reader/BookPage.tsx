import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

import { getBook } from '../../api/endpoints';
import { isBookRedirect, type BookDetail } from '../../api/types';
import { BookErrorView, errorCopy, UnreadableBook } from './BookErrorView';
import { bookRoutePath, pageFromSearch, relFromSplat } from './paths';

const PdfReader = lazy(() => import('../reader-pdf').then((m) => ({ default: m.PdfReader })));
const MarkdownReader = lazy(() =>
  import('../reader-md').then((m) => ({ default: m.MarkdownReader })),
);

function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}

function Reader({ book }: { book: BookDetail }) {
  if (book.error) return <UnreadableBook kind={book.kind} message={book.error} />;
  return (
    <Suspense fallback={null}>
      {book.kind === 'pdf' ? <PdfReader book={book} /> : <MarkdownReader path={book.rel} />}
    </Suspense>
  );
}

/** Route `/book/*`: resolves the book, then hands it to the PDF or Markdown reader. */
export default function BookPage() {
  const path = relFromSplat(useParams()['*']);
  const { search, hash } = useLocation();
  const page = pageFromSearch(search);

  // `?page=` is read only here, never keyed: paging an open PDF must not remount the reader.
  // gcTime 0 drops the entry on leave so reopening a book fetches its fresh saved progress.
  const query = useQuery({
    queryKey: ['book', path],
    queryFn: ({ signal }) => getBook(path, page, { signal }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { data, error } = query;
  const book = data && !isBookRedirect(data) ? data : null;

  let title: string | null = null;
  if (error) title = `${errorCopy(error).status} — book-reader`;
  else if (book) title = `${book.title} — book-reader`;
  useDocumentTitle(title);

  if (error) return <BookErrorView error={error} />;
  if (!data) return null;
  if (isBookRedirect(data)) {
    return <Navigate replace to={{ pathname: bookRoutePath(data.redirect), search, hash }} />;
  }
  return <Reader book={data} />;
}

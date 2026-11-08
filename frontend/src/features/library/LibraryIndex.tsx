import { useState } from 'react';

import { useLibrarySearchParams } from '../../app';
import type { LibraryResponse } from '../../api/types';
import { EmptyState, LinkButton } from '../../ui';
import { BookTable } from './BookTable';
import { BookTiles } from './BookTiles';
import { IndexSide } from './IndexSide';
import { filterBooks, filterGroups } from './filterBooks';
import { LibraryHead } from './LibraryHead';
import styles from './LibraryIndex.module.css';
import { OrganizeDialog } from './OrganizeDialog';
import { ResumeCard } from './ResumeCard';
import { SearchDock } from './SearchDock';
import { useInsideSearch } from './useInsideSearch';
import { useLibraryView } from './useLibraryView';
import { useOrganize } from './useOrganize';

export interface LibraryIndexProps {
  data: LibraryResponse;
  notice: string;
  onDismissNotice: () => void;
}

function organizeText(status: ReturnType<typeof useOrganize>['status']): string {
  if (status.running) {
    const total = status.total ? ` / ${status.total}` : '';
    return `Sorting ${status.done ?? 0}${total}…`;
  }
  if (status.phase === 'done') return 'Categories ready.';
  if (status.error) return `Sorting failed. ${status.error}`;
  return '';
}

export function LibraryIndex({ data, notice, onDismissNotice }: LibraryIndexProps) {
  const { q, inside } = useLibrarySearchParams();
  const [view, setView] = useLibraryView();
  const [category, setCategory] = useState('');
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const organize = useOrganize(data.organize_status, data.book_count);

  // Title filtering and full-text search are exclusive: `inside` leaves the list unfiltered.
  const filter = { term: inside ? '' : q, category };
  const dockTerm = inside ? q : '';
  const [dock, setDock] = useState({ term: dockTerm, closed: false });
  if (dock.term !== dockTerm) setDock({ term: dockTerm, closed: false });
  const dockOpen = dockTerm !== '' && !dock.closed;
  const { query: searchQuery, errorMessage } = useInsideSearch(dockTerm, dockOpen);

  const books = filterBooks(data.books, filter);
  const groups = filterGroups(data.groups, filter);

  const openOrganize = () => {
    organize.clearStartError();
    setOrganizeOpen(true);
  };
  const confirmOrganize = async () => {
    if (await organize.start()) setOrganizeOpen(false);
  };

  return (
    <>
      <div aria-live="polite">
        {dockOpen ? (
          <SearchDock
            term={dockTerm}
            loading={searchQuery.isPending}
            errorMessage={errorMessage}
            data={searchQuery.data}
            onClose={() => setDock({ term: dockTerm, closed: true })}
          />
        ) : null}
      </div>

      <div className={styles.grid}>
        {notice ? (
          <p className={styles.notice} role="status">
            <span>{notice}</span>
            <LinkButton tone="muted" onClick={onDismissNotice}>
              Dismiss
            </LinkButton>
          </p>
        ) : null}
        <ResumeCard resume={data.resume} />
        <IndexSide
          hasResume={data.resume !== null}
          notes={data.resume_notes}
          recent={data.recent}
          bookCount={data.book_count}
        />
      </div>

      <section id="library" aria-labelledby="library-heading">
        <LibraryHead
          categories={data.category_options}
          category={category}
          onCategory={setCategory}
          view={view}
          onView={setView}
          organizeAvailable={data.organize_available}
          onOrganize={openOrganize}
          organizeText={organizeText(organize.status)}
        />
        {books.length === 0 ? (
          <EmptyState className={styles.empty}>
            {data.books.length === 0 ? 'The library has no books yet.' : 'No books match this filter.'}
          </EmptyState>
        ) : view === 'list' ? (
          <BookTable books={books} />
        ) : (
          <BookTiles groups={groups} />
        )}
      </section>

      {data.organize_available ? (
        <OrganizeDialog
          open={organizeOpen}
          onOpenChange={setOrganizeOpen}
          bookCount={data.book_count}
          busy={organize.starting || organize.running}
          error={organize.startError}
          onConfirm={() => void confirmOrganize()}
        />
      ) : null}
    </>
  );
}

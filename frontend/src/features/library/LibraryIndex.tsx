import { useMemo, useState } from 'react';

import { useLibrarySearchParams } from '../../app';
import { readStorage, writeStorage } from '../../app/storage';
import type { LibraryResponse } from '../../api/types';
import { EmptyState, LinkButton } from '../../ui';
import { BookTable } from './BookTable';
import { BookTiles } from './BookTiles';
import { AddPaperDialog } from './AddPaperDialog';
import { filterBooks, filterGroups } from './filterBooks';
import { GROUP_KEY, groupByFacet, type GroupBy } from './grouping';
import home from './Home.module.css';
import { RecentBooks, RecentChats, ResumeNotes } from './HomeDesk';
import { HomeHello } from './HomeHello';
import { LibraryHead } from './LibraryHead';
import styles from './LibraryIndex.module.css';
import { OrganizeDialog } from './OrganizeDialog';
import { ResumeCard } from './ResumeCard';
import { SearchDock } from './SearchDock';
import { useBookMeta } from './useBookMeta';
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

  const meta = useBookMeta();
  const [addOpen, setAddOpen] = useState(false);
  const [storedGroup, setStoredGroup] = useState<GroupBy>(() => {
    const saved = readStorage(GROUP_KEY);
    return saved === 'tag' || saved === 'collection' ? saved : 'category';
  });
  const groupOptions = useMemo<GroupBy[]>(
    () => [
      'category',
      ...(meta.hasTags ? (['tag'] as const) : []),
      ...(meta.hasCollections ? (['collection'] as const) : []),
    ],
    [meta.hasCollections, meta.hasTags],
  );
  // A remembered facet with no data (Zotero off today) falls back to categories.
  const groupBy = groupOptions.includes(storedGroup) ? storedGroup : 'category';
  const chooseGroup = (next: GroupBy) => {
    setStoredGroup(next);
    writeStorage(GROUP_KEY, next);
  };

  // Authors, tags and collections are searchable alongside the title.
  const extraText = (rel: string) => {
    const facts = meta.metaFor(rel);
    return [...facts.authors, ...facts.tags, ...facts.collections, facts.year].join(' ');
  };
  const books = filterBooks(data.books, filter, extraText);
  const groups =
    groupBy === 'category'
      ? filterGroups(data.groups, filter, extraText)
      : groupByFacet(books, groupBy, meta.metaFor);
  const zoteroText = meta.zotero?.available
    ? `Zotero · ${meta.zotero.matched} matched`
    : '';

  const openOrganize = () => {
    organize.clearStartError();
    setOrganizeOpen(true);
  };
  const confirmOrganize = async () => {
    if (await organize.start()) setOrganizeOpen(false);
  };

  return (
    <div className={styles.page}>
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

      <HomeHello
        bookCount={data.book_count}
        zoteroText={zoteroText}
        onAddPaper={() => setAddOpen(true)}
      />

      {notice ? (
        <p className={styles.notice} role="status">
          <span>{notice}</span>
          <LinkButton tone="muted" onClick={onDismissNotice}>
            Dismiss
          </LinkButton>
        </p>
      ) : null}

      <div className={home.jump}>
        <ResumeCard
          resume={data.resume}
          meta={data.resume ? meta.metaFor(data.resume.rel) : undefined}
        />
        <RecentBooks recent={data.recent} />
      </div>
      <div className={home.desk}>
        <ResumeNotes hasResume={data.resume !== null} notes={data.resume_notes} />
        <RecentChats />
      </div>

      <section id="library" aria-labelledby="library-heading">
        <LibraryHead
          categories={data.category_options}
          category={category}
          onCategory={setCategory}
          groupOptions={groupOptions}
          groupBy={groupBy}
          onGroupBy={chooseGroup}
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
          <BookTable books={books} metaFor={meta.metaFor} />
        ) : (
          <BookTiles groups={groups} metaFor={meta.metaFor} />
        )}
      </section>

      <AddPaperDialog open={addOpen} onOpenChange={setAddOpen} />
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
    </div>
  );
}

import { ApiError } from '../../api/client';
import { Button, EmptyState } from '../../ui';
import { LibraryIndex } from './LibraryIndex';
import { useLibraryData } from './useLibraryData';

/** Library index route (`/`): resume card, side notes, filterable tiles or list, search dock. */
export default function LibraryPage() {
  const { query, notice, dismissNotice } = useLibraryData();

  if (!query.data) {
    if (!query.isError) {
      return (
        <div role="status">
          <EmptyState>Loading the library…</EmptyState>
        </div>
      );
    }
    const error = query.error;
    const reason = error instanceof ApiError ? error.detail : error.message;
    return (
      <div role="alert">
        <EmptyState
          title="The library could not be loaded"
          actions={
            <Button variant="ghost" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        >
          {reason}
        </EmptyState>
      </div>
    );
  }
  return <LibraryIndex data={query.data} notice={notice} onDismissNotice={dismissNotice} />;
}

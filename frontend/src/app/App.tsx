import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AppShell } from './AppShell';
import { NotFound } from './NotFound';

// Each route owns one folder under features/.
const LibraryPage = lazy(() => import('../features/library/LibraryPage'));
const AskPage = lazy(() => import('../features/ask/AskPage'));
const BookPage = lazy(() => import('../features/reader/BookPage'));
/** Kitchen sink is for development only; production builds drop the chunk/route. */
const DesignPage = import.meta.env.DEV
  ? lazy(() => import('../features/design/DesignPage'))
  : null;

export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LibraryPage />} />
          <Route path="ask" element={<AskPage />} />
          <Route path="book/*" element={<BookPage />} />
          {DesignPage ? <Route path="design" element={<DesignPage />} /> : null}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

/** Test-only: renders routes inside the shell with a fresh query client and memory router. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from './AppShell';

export function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="location">{pathname + search + hash}</output>;
}

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function renderShell(
  initialPath: string,
  pages: ReactNode = <p>page</p>,
  client: QueryClient = newQueryClient(),
) {
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={pages} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...result };
}

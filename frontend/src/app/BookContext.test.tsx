import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { BookContextProvider, useBookContext } from './BookContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <BookContextProvider>{children}</BookContextProvider>
);

describe('BookContext', () => {
  it('starts empty, follows the reader, and clears on null', () => {
    const { result } = renderHook(() => useBookContext(), { wrapper });
    expect(result.current).toMatchObject({ book: null, page: null });

    act(() => result.current.setBookContext({ book: 'a/b.pdf', page: 3 }));
    expect(result.current).toMatchObject({ book: 'a/b.pdf', page: 3 });

    act(() => result.current.setBookContext({ book: 'a/b.pdf', page: 4 }));
    expect(result.current.page).toBe(4);

    act(() => result.current.setBookContext({ book: 'notes.md' }));
    expect(result.current).toMatchObject({ book: 'notes.md', page: null });

    act(() => result.current.setBookContext(null));
    expect(result.current).toMatchObject({ book: null, page: null });
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { highlight } from './highlight';
import { installLibraryApi, renderLibrary } from './testHarness';

afterEach(() => {
  vi.unstubAllGlobals();
});

const HITS = {
  kind: 'library',
  backend: 'elasticsearch',
  hits: [
    {
      book: 'ml/Deep Learning.pdf',
      kind: 'pdf',
      page: 12,
      line: null,
      line_end: null,
      section: 'Optimization',
      snippet: 'Why <script>alert(1)</script> gradients vanish: GRADIENT descent stalls.',
    },
    {
      book: 'notes/Field Notes.md',
      kind: 'md',
      page: null,
      line: 40,
      line_end: 41,
      section: '',
      snippet: 'a gradient note',
    },
  ],
};

describe('search dock', () => {
  it('lists full-text hits as links and highlights matches without parsing markup', async () => {
    const api = installLibraryApi({ search: () => ({ status: 200, body: HITS }) });
    const { container } = renderLibrary('/?q=gradient&inside=1');

    expect(await screen.findByText('2 results inside books')).toBeInTheDocument();
    expect(screen.getByText('elasticsearch')).toBeInTheDocument();
    expect(api.calls).toContain('GET /api/search?q=gradient&limit=20');

    const dock = within(screen.getByText('2 results inside books').closest('div')!.parentElement!);
    expect(dock.getByRole('link', { name: 'Deep Learning.pdf · p.12 · § Optimization' })).toHaveAttribute(
      'href',
      '/book/ml/Deep%20Learning.pdf#p12',
    );
    expect(dock.getByRole('link', { name: 'Field Notes.md · L40' })).toHaveAttribute(
      'href',
      '/book/notes/Field%20Notes.md#L40',
    );

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    const marks = Array.from(container.querySelectorAll('mark')).map((mark) => mark.textContent);
    expect(marks).toEqual(['gradient', 'GRADIENT', 'gradient']);

    // Full-text mode leaves the title list unfiltered.
    expect(screen.getByRole('group', { name: 'Books' })).toHaveTextContent('Field Notes');
  });

  it('closes, and does not call the search endpoint for a plain title filter', async () => {
    const user = userEvent.setup();
    const api = installLibraryApi({ search: () => ({ status: 200, body: HITS }) });
    renderLibrary('/?q=gradient&inside=1');

    await screen.findByText('2 results inside books');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('2 results inside books')).not.toBeInTheDocument();
    expect(api.count('GET /api/search')).toBe(1);
  });

  it('does not search for a title filter', async () => {
    const api = installLibraryApi();
    renderLibrary('/?q=deep');
    await screen.findByRole('group', { name: 'Books' });
    expect(api.count('GET /api/search')).toBe(0);
    expect(screen.queryByText(/inside books/)).not.toBeInTheDocument();
  });

  it('reports an empty result', async () => {
    installLibraryApi();
    renderLibrary('/?q=nothing&inside=1');
    expect(await screen.findByText('0 results inside books')).toBeInTheDocument();
    expect(screen.getByText('No matches in the library.')).toBeInTheDocument();
  });

  it('shows the server reason when library search is unavailable (503)', async () => {
    installLibraryApi({
      search: () => ({ status: 503, body: { detail: 'library search unavailable: index offline' } }),
    });
    renderLibrary('/?q=gradient&inside=1');
    expect(await screen.findByText('Search failed')).toBeInTheDocument();
    expect(screen.getByText('library search unavailable: index offline')).toBeInTheDocument();
  });
});

describe('highlight', () => {
  it('returns the text untouched when nothing matches', () => {
    expect(highlight('plain text', 'zzz')).toEqual(['plain text']);
  });
});

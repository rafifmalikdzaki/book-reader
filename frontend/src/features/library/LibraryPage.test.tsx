import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installLibraryApi, makeLibrary, renderLibrary } from './testHarness';

/** Open a Base UI combobox and pick the option with the given name. */
async function pickOption(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, optionName: RegExp | string) {
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name: optionName }));
}


beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function tiles() {
  return within(await screen.findByRole('group', { name: 'Books' }));
}

describe('library page', () => {
  it('renders the resume card, notes, recent books and tiles from the library', async () => {
    installLibraryApi();
    renderLibrary();

    const heading = await screen.findByRole('heading', { level: 2, name: 'Deep Learning' });
    expect(within(heading).getByRole('link')).toHaveAttribute('href', '/book/ml/Deep%20Learning.pdf#p12');
    expect(screen.getByText('PDF · § Optimization · ml')).toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      '40% read',
    );
    expect(screen.getByText('Page 12 of 800')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume page 12' })).toHaveAttribute(
      'href',
      '/book/ml/Deep%20Learning.pdf#p12',
    );
    expect(screen.getByText('Shelf · ml/Deep Learning.pdf')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Gradients vanish.' })).toHaveAttribute(
      'href',
      '/book/ml/Deep%20Learning.pdf#p12',
    );
    expect(screen.getByRole('link', { name: 'See line forty.' })).toHaveAttribute(
      'href',
      '/book/notes/Field%20Notes.md#L40',
    );
    expect(screen.getByRole('link', { name: 'Pattern Recognition' })).toHaveAttribute(
      'href',
      '/book/ml/Pattern%20Recognition.pdf#p3',
    );
    expect(screen.getByText('p.3 · § Intro')).toBeInTheDocument();
    expect(screen.getByText('3 books · local library')).toBeInTheDocument();

    const grid = await tiles();
    expect(grid.getByRole('heading', { name: 'Machine learning' })).toBeInTheDocument();
    expect(grid.getByRole('heading', { name: 'Miscellaneous' })).toBeInTheDocument();
    const cover = document.querySelector('[role="group"] img');
    expect(cover).toHaveAttribute('loading', 'lazy');
    expect(cover).toHaveAttribute('width', '300');
    expect(cover).toHaveAttribute('height', '400');
    expect(cover?.getAttribute('src')).toBe('/thumb.jpg?path=ml%2FDeep%20Learning.pdf&width=300');
    expect(grid.getByText('MD')).toBeInTheDocument();
    expect(grid.getByRole('link', { name: /Field Notes/ })).toHaveAttribute(
      'href',
      '/book/notes/Field%20Notes.md',
    );
  });

  it('shows the empty plate when nothing was opened', async () => {
    installLibraryApi({ libraries: [makeLibrary({ resume: null, resume_notes: [], recent: [] })] });
    renderLibrary();

    expect(await screen.findByRole('heading', { level: 2, name: 'Nothing open yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the library' })).toHaveAttribute('href', '#library');
    expect(screen.getByText('Select text in a book to keep a passage here.')).toBeInTheDocument();
    expect(screen.queryByText('Recently opened')).not.toBeInTheDocument();
  });

  it('toggles tiles and list and remembers the choice', async () => {
    const user = userEvent.setup();
    installLibraryApi();
    const first = renderLibrary();

    await tiles();
    expect(screen.getByRole('tab', { name: 'Tiles' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(window.localStorage.getItem('br-view')).toBe('list');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'Field Notes' })).toHaveAttribute(
      'href',
      '/book/notes/Field%20Notes.md',
    );
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('738')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Books' })).not.toBeInTheDocument();
    first.unmount();

    renderLibrary();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  });

  it('filters titles live from ?q= in both views', async () => {
    const user = userEvent.setup();
    installLibraryApi();
    const api = renderLibrary('/?q=PATTERN');

    const grid = await tiles();
    expect(grid.getByRole('link', { name: /Pattern Recognition/ })).toBeInTheDocument();
    expect(grid.queryByRole('link', { name: /Deep Learning/ })).not.toBeInTheDocument();
    expect(grid.queryByRole('heading', { name: 'Miscellaneous' })).not.toBeInTheDocument();
    expect(grid.getByText('1')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    api.unmount();
  });

  it('says so when no book matches', async () => {
    installLibraryApi();
    renderLibrary('/?q=zzz');
    expect(await screen.findByText('No books match this filter.')).toBeInTheDocument();
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    installLibraryApi();
    renderLibrary();

    const select = await screen.findByRole('combobox', { name: 'Filter by category' });
    expect(select).toHaveValue('');
    await pickOption(user, select, /Miscellaneous/);
    const grid = await tiles();
    expect(grid.getByRole('link', { name: /Field Notes/ })).toBeInTheDocument();
    expect(grid.queryByRole('link', { name: /Pattern Recognition/ })).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the library cannot load', async () => {
    const user = userEvent.setup();
    const api = installLibraryApi({ libraryFailure: { status: 500, body: { detail: 'index exploded' } } });
    renderLibrary();

    expect(await screen.findByRole('alert')).toHaveTextContent('index exploded');
    api.libraryFailure = null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Deep Learning' })).toBeInTheDocument();
  });

  it('does not refetch the library on window focus', async () => {
    const api = installLibraryApi();
    renderLibrary();
    await screen.findByRole('heading', { level: 2, name: 'Deep Learning' });
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(api.count('GET /api/library')).toBe(1));
  });

  it('refetches on remount so reading progress is fresh', async () => {
    const api = installLibraryApi({
      libraries: [
        makeLibrary({ resume: { ...makeLibrary().resume!, page: 12, percent: 40 } }),
        makeLibrary({ resume: { ...makeLibrary().resume!, page: 80, percent: 10 } }),
      ],
    });
    const first = renderLibrary();
    expect(await screen.findByRole('link', { name: 'Resume page 12' })).toBeInTheDocument();
    first.unmount();

    renderLibrary('/', first.client);
    expect(await screen.findByRole('link', { name: 'Resume page 80' })).toBeInTheDocument();
    expect(api.count('GET /api/library')).toBe(2);
  });

  it('shows Zotero authors on tiles, searches them, and groups by tag', async () => {
    installLibraryApi();
    const fetchLibrary = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname;
        if (path === '/api/zotero') {
          return new Response(
            JSON.stringify({
              available: true,
              reason: '',
              item_count: 5,
              matched: 1,
              collections: ['Thesis'],
              books: {
                'ml/Deep Learning.pdf': {
                  key: 'K1',
                  title: 'Deep Learning',
                  creators: ['Ian Goodfellow', 'Yoshua Bengio', 'Aaron Courville'],
                  year: '2016',
                  item_type: 'book',
                  publication: '',
                  doi: '',
                  url: '',
                  tags: ['Neural networks'],
                  collections: ['Thesis'],
                  matched_by: 'content',
                  select_uri: 'zotero://select/library/items/K1',
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return fetchLibrary(input, init);
      }),
    );
    const user = userEvent.setup();
    renderLibrary();

    const grid = await tiles();
    expect(await grid.findByText('Goodfellow et al. · 2016')).toBeInTheDocument();
    expect(screen.getByText('Zotero · 1 matched')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Zotero' })).toHaveAttribute(
      'href',
      'zotero://select/library/items/K1',
    );

    await pickOption(user, screen.getByRole('combobox', { name: 'Group books by' }), 'Group by tag');
    const regrouped = await tiles();
    expect(regrouped.getByRole('heading', { name: 'Neural networks' })).toBeInTheDocument();
    expect(regrouped.getByRole('heading', { name: 'Untagged' })).toBeInTheDocument();
  });

  it('imports a paper by arXiv id and opens it', async () => {
    const api = installLibraryApi();
    const inner = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), 'http://localhost').pathname;
        if (path === '/api/papers/import') {
          const { identifier } = JSON.parse(String(init?.body)) as { identifier: string };
          if (identifier === 'nope') {
            return new Response(JSON.stringify({ detail: 'Paste a DOI or an arXiv id.' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({ rel: 'Papers/Lovelace 2024 - Maths.pdf', created: true }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return inner(input, init);
      }),
    );
    const user = userEvent.setup();
    renderLibrary();

    await user.click(await screen.findByRole('button', { name: 'Add paper' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a paper' }));
    const field = dialog.getByRole('textbox', { name: 'DOI or arXiv id' });
    await user.type(field, 'nope');
    await user.click(dialog.getByRole('button', { name: 'Add to library' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Paste a DOI or an arXiv id.');

    await user.clear(field);
    await user.type(field, '2403.04807');
    await user.click(dialog.getByRole('button', { name: 'Add to library' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/book/Papers/Lovelace%202024%20-%20Maths.pdf',
      ),
    );
    expect(api.count('GET /api/library')).toBeGreaterThan(1);
  });
});

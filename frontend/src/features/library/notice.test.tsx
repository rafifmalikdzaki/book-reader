import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLibraryApi, makeLibrary, renderLibrary } from './testHarness';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOTICE = '2 books were moved; your notes followed them.';

describe('relocation notice', () => {
  it('is shown, survives a refetch that returns "", and can be dismissed', async () => {
    const user = userEvent.setup();
    const api = installLibraryApi({
      libraries: [makeLibrary({ relocation_notice: NOTICE }), makeLibrary({ relocation_notice: '' })],
    });
    const { client } = renderLibrary();

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();

    await client.invalidateQueries({ queryKey: ['library'] });
    await waitFor(() => expect(api.count('GET /api/library')).toBe(2));
    expect(screen.getByText(NOTICE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('survives a remount even though the request is not aborted', async () => {
    const api = installLibraryApi({
      libraries: [makeLibrary({ relocation_notice: NOTICE }), makeLibrary({ relocation_notice: '' })],
    });
    const first = renderLibrary();
    const client = first.client;
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    first.unmount();

    renderLibrary('/', client);
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(api.count('GET /api/library')).toBe(2);
  });

  it('is absent when the server sends none', async () => {
    installLibraryApi();
    renderLibrary();
    await screen.findByRole('heading', { level: 1, name: 'Deep Learning' });
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});

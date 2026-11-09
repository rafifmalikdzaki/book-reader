import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeApi } from './fakeApi';
import { newQueryClient, renderShell } from './testing';

/** Open a Base UI combobox and pick the option with the given name. */
async function pickOption(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, optionName: RegExp | string) {
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name: optionName }));
}


afterEach(() => {
  vi.unstubAllGlobals();
});

async function openOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Options' }));
  return screen.findByRole('dialog', { name: 'Which mind answers?' });
}

describe('Options dialog', () => {
  it('saves the model, invalidates chat queries, and closes', async () => {
    const api = installFakeApi();
    const client: QueryClient = newQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const user = userEvent.setup();
    renderShell('/', undefined, client);

    await openOptions(user);
    const select = await screen.findByRole('combobox', { name: 'Chat model' });
    expect(select).toHaveTextContent('Auto — follow the provider chain');
    await pickOption(user, select, /mistral · small/);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.selected).toBe('mistral:small');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat'] });
    expect(screen.getByRole('button', { name: 'Options' })).toHaveFocus();
  });

  it('shows a save error inside the dialog and keeps it open', async () => {
    installFakeApi({ fail: { 'POST /api/chat/options': { status: 400, detail: 'Unknown model' } } });
    const user = userEvent.setup();
    renderShell('/');
    await openOptions(user);
    await screen.findByRole('combobox', { name: 'Chat model' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown model');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports "Options unavailable." when the options cannot load', async () => {
    installFakeApi({ fail: { 'GET /api/chat/options': { status: 500, detail: 'down' } } });
    const user = userEvent.setup();
    renderShell('/');
    await openOptions(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Options unavailable.');
  });

  it('reindexes, shows the result in the dialog, and toasts the notice', async () => {
    const api = installFakeApi({ reindexNotice: '2 books moved.' });
    const user = userEvent.setup();
    renderShell('/');
    await openOptions(user);
    await user.click(screen.getByRole('button', { name: 'Reindex library' }));

    await waitFor(() => expect(screen.getAllByText('2 books moved.').length).toBeGreaterThan(1));
    expect(api.calls.some((call) => call.path === '/api/library/reindex')).toBe(true);
  });

  it('shows a reindex failure in the dialog without a toast', async () => {
    installFakeApi({ fail: { 'POST /api/library/reindex': { status: 500, detail: 'Reindex failed: disk full' } } });
    const user = userEvent.setup();
    renderShell('/');
    await openOptions(user);
    await user.click(screen.getByRole('button', { name: 'Reindex library' }));
    expect(await screen.findByText('Reindex failed: disk full')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reindex library' })).toBeEnabled();
  });
});

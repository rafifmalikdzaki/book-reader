import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installLibraryApi, makeLibrary, renderLibrary } from './testHarness';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const running = (done: number) => ({
  available: true,
  running: true,
  phase: 'assign' as const,
  done,
  total: 3,
});

describe('auto-organize', () => {
  it('confirms, polls while running, then refreshes the library', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = installLibraryApi({
      statuses: [running(1), running(2), { available: true, running: false, phase: 'done', done: 3, total: 3 }],
    });
    renderLibrary();
    await screen.findByRole('heading', { level: 2, name: 'Deep Learning' });

    await user.click(screen.getByRole('button', { name: 'Auto-organize' }));
    const dialog = await screen.findByRole('dialog', { name: 'Auto-organize the library?' });
    expect(dialog).toHaveTextContent('for 3 books');
    expect(dialog).toHaveTextContent('Files stay exactly where they are.');
    expect(api.count('POST /api/organize')).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Start sorting' }));
    expect(api.bodies).toEqual([{ confirm: true }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Sorting 0 / 3…')).toBeInTheDocument();
    expect(api.count('GET /api/organize/status')).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText('Sorting 1 / 3…')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText('Sorting 2 / 3…')).toBeInTheDocument();
    expect(api.count('GET /api/library')).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText('Categories ready.')).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET /api/library')).toBe(2));

    const polls = api.count('GET /api/organize/status');
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(api.count('GET /api/organize/status')).toBe(polls);
  });

  it('does not start when the dialog is cancelled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = installLibraryApi();
    renderLibrary();

    await user.click(await screen.findByRole('button', { name: 'Auto-organize' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.count('POST /api/organize')).toBe(0);
  });

  it('keeps the dialog open and shows the reason when starting fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    installLibraryApi({ start: { status: 409, body: { detail: 'Already sorting' } } });
    renderLibrary();

    await user.click(await screen.findByRole('button', { name: 'Auto-organize' }));
    await user.click(await screen.findByRole('button', { name: 'Start sorting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already sorting');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start sorting' })).toBeEnabled();
  });

  it('resumes polling when the page loads mid-run and reports a failure', async () => {
    const api = installLibraryApi({
      libraries: [makeLibrary({ organize_status: running(1) })],
      statuses: [{ available: true, running: false, phase: 'error', error: 'quota exceeded' }],
    });
    renderLibrary();

    expect(await screen.findByText('Sorting 1 / 3…')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText('Sorting failed. quota exceeded')).toBeInTheDocument();
    expect(api.count('GET /api/library')).toBe(1);
  });

  it('hides the control when the organizer is not configured', async () => {
    installLibraryApi({ libraries: [makeLibrary({ organize_available: false })] });
    renderLibrary();
    await screen.findByRole('heading', { level: 2, name: 'Deep Learning' });
    expect(screen.queryByRole('button', { name: 'Auto-organize' })).not.toBeInTheDocument();
  });
});

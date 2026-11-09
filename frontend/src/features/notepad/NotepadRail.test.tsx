import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeApi, makeNote } from '../../app/fakeApi';
import { renderShell } from '../../app/testing';
import { AUTOSAVE_MS } from './NoteCard';
import { useNotepad, type NoteDraft } from './index';

function Capture({ draft }: { draft: NoteDraft }) {
  const { compose } = useNotepad();
  return (
    <button type="button" onClick={() => compose(draft)}>
      Capture
    </button>
  );
}

const PDF_DRAFT: NoteDraft = { book: 'sub/paper.pdf', kind: 'pdf', page: 12, quote: 'Hello \n  world' };
async function openNotes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Notes' }));
}

const IDEAS = { id: 'g1', name: 'Ideas', created: 1 };

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Notepad compose', () => {
  it('opens the rail on compose, saves the note, and lists it with a link back to the page', async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderShell('/book/sub/paper.pdf', <Capture draft={PDF_DRAFT} />);
    await screen.findByRole('button', { name: 'Capture' });

    await user.click(screen.getByRole('button', { name: 'Capture' }));
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'true');
    const form = await screen.findByRole('region', { name: 'New note' });
    expect(within(form).getByText('paper.pdf · p.12')).toBeInTheDocument();
    expect(within(form).getByText('Hello world')).toBeInTheDocument();
    const comment = within(form).getByRole('textbox', { name: 'Comment' });
    expect(comment).toHaveFocus();

    await user.type(comment, 'because');
    await user.click(within(form).getByRole('button', { name: 'Save note' }));

    const link = await screen.findByRole('link', { name: 'paper.pdf · p.12' });
    expect(link).toHaveAttribute('href', '/book/sub/paper.pdf#p12');
    expect(screen.getByRole('heading', { name: 'Inbox (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'New note' })).not.toBeInTheDocument();
    const post = api.calls.find((call) => call.method === 'POST' && call.path === '/api/notepad/notes');
    expect(post?.body).toMatchObject({ book: 'sub/paper.pdf', kind: 'pdf', page: 12, group: 'inbox', comment: 'because' });
  });

  it('cancels with Cancel, saves with Ctrl+Enter, and returns focus to the opener on Esc', async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderShell('/book/sub/paper.pdf', <Capture draft={PDF_DRAFT} />);
    const capture = await screen.findByRole('button', { name: 'Capture' });

    await user.click(capture);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'New note' })).not.toBeInTheDocument();

    await user.click(capture);
    await screen.findByRole('region', { name: 'New note' });
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('link', { name: 'paper.pdf · p.12' });

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'false');
    expect(capture).toHaveFocus();
  });

  it('links Markdown notes to their line anchor', async () => {
    installFakeApi({
      notes: [makeNote({ book: 'a b/notes.md', kind: 'md', page: null, line_start: 40, line_end: 44, section: 'Intro', paragraph: 2 })],
    });
    const user = userEvent.setup();
    renderShell('/');
    await openNotes(user);
    const link = await screen.findByRole('link', { name: 'notes.md · lines 40–44 · § Intro · ¶ 2' });
    expect(link).toHaveAttribute('href', '/book/a%20b/notes.md#L40');
  });
});

describe('Notepad notes and groups', () => {
  it('autosaves an annotation 700 ms after typing and on blur', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({ notes: [makeNote()] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderShell('/');
    await openNotes(user);
    const annotation = await screen.findByRole('textbox', { name: 'Annotation' });
    const patches = () => api.calls.filter((call) => call.method === 'PATCH');

    await user.type(annotation, 'idea');
    act(() => vi.advanceTimersByTime(AUTOSAVE_MS - 50));
    expect(patches()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(100));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({ comment: 'idea' });

    await user.type(annotation, ' more');
    await user.tab();
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]?.body).toEqual({ comment: 'idea more' });
    act(() => vi.advanceTimersByTime(AUTOSAVE_MS * 2));
    expect(patches()).toHaveLength(2);
  });

  it('deleting a group removes its notes after confirmation', async () => {
    const api = installFakeApi({
      groups: [{ id: 'inbox', name: 'Inbox', created: 0 }, IDEAS],
      notes: [makeNote({ id: 'a', quote: 'in inbox' }), makeNote({ id: 'b', group: 'g1', quote: 'in ideas' })],
    });
    const user = userEvent.setup();
    renderShell('/');
    await openNotes(user);
    await screen.findByText('in ideas');
    expect(screen.queryByRole('button', { name: 'Delete group Inbox' })).not.toBeInTheDocument();

    // Cancel in confirmation dialog
    await user.click(screen.getByRole('button', { name: 'Delete group Ideas' }));
    expect(await screen.findByRole('dialog', { name: 'Delete group “Ideas”?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('in ideas')).toBeInTheDocument();

    // Confirm in confirmation dialog
    await user.click(screen.getByRole('button', { name: 'Delete group Ideas' }));
    await user.click(await screen.findByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(screen.queryByText('in ideas')).not.toBeInTheDocument());
    expect(screen.getByText('in inbox')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Ideas/ })).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('moves and deletes a note', async () => {
    installFakeApi({ groups: [{ id: 'inbox', name: 'Inbox', created: 0 }, IDEAS], notes: [makeNote()] });
    const user = userEvent.setup();
    renderShell('/');
    await openNotes(user);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Move note to group' }), 'g1');
    expect(await screen.findByRole('heading', { name: 'Ideas (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inbox (0)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Annotation' })).not.toBeInTheDocument());
  });

  it('adds a group from the name field', async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderShell('/');
    await openNotes(user);
    const name = await screen.findByRole('textbox', { name: 'New group name' });
    await user.type(name, '  Methods {Enter}');
    expect(await screen.findByRole('heading', { name: 'Methods (0)' })).toBeInTheDocument();
    expect(name).toHaveValue('');
  });
});

describe('Notepad states', () => {
  it('shows the load error, the empty state, and the export links', async () => {
    installFakeApi({ fail: { 'GET /api/notepad': { status: 500, detail: 'disk gone' } } });
    const user = userEvent.setup();
    renderShell('/');
    await openNotes(user);
    expect(await screen.findByText('Cannot load notes: disk gone')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export notes' })).toHaveAttribute(
      'href',
      '/api/notepad/export?format=markdown',
    );
    expect(screen.getByRole('link', { name: 'JSON' })).toHaveAttribute('href', '/api/notepad/export?format=json');
  });

  it('shows "No groups yet." when the store has none', async () => {
    installFakeApi({ groups: [] });
    const user = userEvent.setup();
    renderShell('/');
    await openNotes(user);
    expect(await screen.findByText('No groups yet.')).toBeInTheDocument();
  });
});

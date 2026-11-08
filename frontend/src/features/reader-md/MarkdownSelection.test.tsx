import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openMarkdown, serveMarkdown, makeDoc } from './testKit';

const { compose } = vi.hoisted(() => ({ compose: vi.fn() }));

vi.mock('../chat-rail', () => ({ ChatRail: () => null }));
vi.mock('../notepad', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../notepad')>()),
  useNotepad: () => ({ compose, refresh: vi.fn() }),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  // jsdom ranges have no layout.
  Range.prototype.getBoundingClientRect = () => ({ left: 120, top: 300 }) as DOMRect;
});
afterEach(() => {
  vi.unstubAllGlobals();
  compose.mockClear();
  window.getSelection()?.removeAllRanges();
});

function select(element: HTMLElement | null): void {
  if (!element) throw new Error('missing element');
  window.getSelection()?.selectAllChildren(element);
  fireEvent.mouseUp(document);
}

describe('Markdown selection to note', () => {
  it('offers a bubble that composes a note with section path and paragraph number', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    select(document.getElementById('L7'));

    const bubble = screen.getByRole('button', { name: '+ Note' });
    expect(bubble).toHaveStyle({ left: '120px', top: '260px' });
    fireEvent.click(bubble);

    expect(compose).toHaveBeenCalledWith({
      book: 'notes/n.md',
      kind: 'md',
      quote: 'Second paragraph text.',
      section: 'Title › Methods',
      paragraph: 2,
    });
    expect(screen.queryByRole('button', { name: '+ Note' })).not.toBeInTheDocument();
  });

  it('keeps only the last two headings and drops the bubble for a collapsed selection', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    select(document.getElementById('L11'));
    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'Methods › Results', paragraph: 3 }),
    );

    select(document.getElementById('L7'));
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(document);
    expect(screen.queryByRole('button', { name: '+ Note' })).not.toBeInTheDocument();
  });

  it('offers the note bubble for a keyboard selection', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    const paragraph = document.getElementById('L7');
    if (!paragraph) throw new Error('missing paragraph');
    window.getSelection()?.selectAllChildren(paragraph);
    document.dispatchEvent(new Event('selectionchange'));

    expect(await screen.findByRole('button', { name: '+ Note' })).toBeInTheDocument();
  });

  it('does not reopen the bubble after it was captured', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    const paragraph = document.getElementById('L7');
    if (!paragraph) throw new Error('missing paragraph');
    window.getSelection()?.selectAllChildren(paragraph);
    document.dispatchEvent(new Event('selectionchange'));
    fireEvent.mouseUp(document);

    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '+ Note' })).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('button', { name: '+ Note' })).not.toBeInTheDocument();
  });

  it('ignores selections outside the document', async () => {
    serveMarkdown(makeDoc());
    await openMarkdown();
    select(screen.getByRole('banner'));
    expect(screen.queryByRole('button', { name: '+ Note' })).not.toBeInTheDocument();
  });
});

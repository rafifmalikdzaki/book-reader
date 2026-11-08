import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Rail, usePanel } from '../ui';
import { installFakeApi } from './fakeApi';
import { ContentsPortal, useStage } from './index';
import { renderShell } from './testing';

// The real reader chat rail belongs to another module; a stand-in keeps this test about the shell.
vi.mock('../features/chat-rail', () => ({
  ChatRail: function FakeChatRail() {
    const chat = usePanel('chat');
    return (
      <Rail {...chat.railProps} label="Ask the library" title="Ask">
        <textarea aria-label="Question" />
      </Rail>
    );
  },
}));

beforeEach(() => {
  installFakeApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const BOOK = '/book/sub/paper.pdf';

describe('AppShell panels', () => {
  it('opens one rail at a time and closes on Esc', async () => {
    const user = userEvent.setup();
    renderShell(BOOK);
    const notes = screen.getByRole('button', { name: 'Notes' });
    const ask = screen.getByRole('button', { name: 'Ask' });

    await user.click(notes);
    expect(notes).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Researcher notepad' })).toBeVisible();

    await user.click(ask);
    expect(notes).toHaveAttribute('aria-expanded', 'false');
    expect(ask).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Ask the library' })).toBeVisible();
    expect(screen.queryByRole('complementary', { name: 'Researcher notepad' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(ask).toHaveAttribute('aria-expanded', 'false');
  });

  it('restores focus to the opener when a rail closes', async () => {
    const user = userEvent.setup();
    renderShell(BOOK);
    const notes = screen.getByRole('button', { name: 'Notes' });
    await user.click(notes);
    await user.keyboard('{Escape}');
    expect(notes).toHaveFocus();
  });

  it('moves focus into the rail on open, as shell.js did', async () => {
    const user = userEvent.setup();
    renderShell('/');
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.getByRole('button', { name: 'Close notes' })).toHaveFocus();
  });

  it('closes open rails on navigation, like a page load', async () => {
    const user = userEvent.setup();
    renderShell(BOOK);
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    await user.click(screen.getByRole('link', { name: /book·reader/ }));
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('AppShell chrome', () => {
  it('links to /ask with aria-current on library routes and toggles chat on book routes', () => {
    const ask = renderShell('/ask');
    expect(screen.getByRole('link', { name: 'Ask' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument();
    ask.unmount();

    const library = renderShell('/');
    expect(screen.getByRole('link', { name: 'Ask' })).not.toHaveAttribute('aria-current');
    library.unmount();

    renderShell(BOOK);
    expect(screen.queryByRole('link', { name: 'Ask' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('aria-controls', 'chat');
  });

  it('focuses main and updates the title on client navigation', async () => {
    const user = userEvent.setup();
    renderShell('/');
    await user.click(screen.getByRole('link', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    expect(document.title).toBe('Ask — book-reader');
  });

  it('applies the stage a page declares and clears it on unmount', () => {
    function PdfPage() {
      useStage('pdf');
      return <p>pdf page</p>;
    }
    const { unmount } = renderShell(BOOK, <PdfPage />);
    expect(screen.getByRole('main')).toHaveAttribute('data-stage', 'pdf');
    unmount();
    renderShell('/');
    expect(screen.getByRole('main')).not.toHaveAttribute('data-stage');
  });

  it('shows the Outline toggle only while a page owns a contents rail', async () => {
    const user = userEvent.setup();
    function MdPage() {
      const contents = usePanel('contents');
      return (
        <ContentsPortal>
          <Rail {...contents.railProps} side="left" label="Outline" title="Contents">
            <a href="#L1">Intro</a>
          </Rail>
        </ContentsPortal>
      );
    }
    const first = renderShell('/book/note.md', <MdPage />);
    const toggle = await screen.findByRole('button', { name: 'Outline' });
    expect(toggle).toHaveAttribute('aria-controls', 'contents');
    await user.click(toggle);
    expect(screen.getByRole('complementary', { name: 'Outline' })).toBeVisible();
    first.unmount();

    renderShell('/');
    expect(screen.queryByRole('button', { name: 'Outline' })).not.toBeInTheDocument();
  });
});

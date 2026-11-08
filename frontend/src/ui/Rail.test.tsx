import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelProvider } from './PanelProvider';
import { Rail, RailBody } from './Rail';
import { stubViewport } from './test-utils';
import { usePanel } from './usePanel';

function Panels({ onOpen }: { onOpen?: () => void }) {
  const notes = usePanel('notepad', { onOpen });
  const chat = usePanel('chat');
  return (
    <>
      <button type="button" {...notes.toggleProps}>
        Notes
      </button>
      <button type="button" {...chat.toggleProps}>
        Ask
      </button>
      <Rail {...notes.railProps} label="Researcher notepad" title="Notes">
        <RailBody>
          <input aria-label="New group name" />
          <button type="button">Add</button>
        </RailBody>
      </Rail>
      <Rail {...chat.railProps} label="Ask the library" title="Ask">
        <RailBody>
          <textarea aria-label="Question" />
        </RailBody>
      </Rail>
      <main id="main" tabIndex={-1} />
    </>
  );
}

function renderPanels(onOpen?: () => void) {
  return render(
    <PanelProvider>
      <Panels onOpen={onOpen} />
    </PanelProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.className = '';
});

describe('Rail + usePanel', () => {
  it('starts hidden and toggles with aria-expanded', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    renderPanels();
    const toggle = screen.getByRole('button', { name: 'Notes' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Researcher notepad' })).toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens one rail at a time and fires onOpen on the closed to open transition', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPanels(onOpen);
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('complementary', { name: 'Ask the library' })).toBeVisible();
    expect(screen.queryByRole('complementary', { name: 'Researcher notepad' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('focuses the first control on open and restores focus to the opener on Escape', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    renderPanels();
    const toggle = screen.getByRole('button', { name: 'Notes' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Close notes' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('closes from the header button', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    renderPanels();
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    await user.click(screen.getByRole('button', { name: 'Close notes' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('wraps Tab inside the open rail on phones and sets body.panel-open', async () => {
    stubViewport(390);
    const user = userEvent.setup();
    renderPanels();
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    expect(document.body).toHaveClass('panel-open');
    expect(screen.getByRole('dialog', { name: 'Researcher notepad' })).toBeVisible();
    await user.tab(); // close -> input
    await user.tab(); // input -> Add
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();
    await user.tab(); // Add -> wraps to the close button
    expect(screen.getByRole('button', { name: 'Close notes' })).toHaveFocus();
    await user.tab({ shift: true }); // close -> wraps back to Add
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(document.body).not.toHaveClass('panel-open');
  });

  it('falls back to main when the opener is no longer focusable', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    renderPanels();
    const toggle = screen.getByRole('button', { name: 'Notes' });
    await user.click(toggle);
    toggle.hidden = true;
    await user.keyboard('{Escape}');
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('does not set body.panel-open or trap Tab on desktop', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    renderPanels();
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    expect(document.body).not.toHaveClass('panel-open');
    await user.tab();
    await user.tab();
    await user.tab(); // leaves the rail for the next focusable (the chat toggle precedes it)
    expect(screen.getByRole('button', { name: 'Add' })).not.toHaveFocus();
  });
});

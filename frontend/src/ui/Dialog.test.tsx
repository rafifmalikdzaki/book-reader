import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Dialog } from './Dialog';

function Harness({ description }: { description?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open options
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Which mind answers?" description={description}>
        <button type="button">Save</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('exposes a named modal dialog with its description', async () => {
    const user = userEvent.setup();
    render(<Harness description="Applies to Ask." />);
    await user.click(screen.getByRole('button', { name: 'Open options' }));
    const dialog = screen.getByRole('dialog', { name: 'Which mind answers?' });
    expect(dialog).toHaveAccessibleDescription('Applies to Ask.');
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open options' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes from the close button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open options' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open options' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      // Base UI moves focus off its focus guard on the next animation frame, so a
      // tab can land on the guard for one frame before it is sent back inside.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    }
  });
});

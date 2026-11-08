import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('is named by its label, not by the decorative glyph', () => {
    render(<IconButton label="Options" icon="⚙" />);
    const button = screen.getByRole('button', { name: 'Options' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('activates with the keyboard', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<IconButton label="Close" icon="×" onClick={onClick} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

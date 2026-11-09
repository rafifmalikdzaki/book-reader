import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Segmented } from './Segmented';

const OPTIONS = [
  { value: 'tiles', label: 'Tiles' },
  { value: 'list', label: 'List' },
] as const;

function Harness() {
  const [view, setView] = useState<'tiles' | 'list'>('tiles');
  return <Segmented label="Library view" options={OPTIONS} value={view} onChange={setView} />;
}

describe('Segmented', () => {
  it('marks exactly the current option as selected inside a named tab list', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Library view' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tiles' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'false');
  });

  it('switches by click and by keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    // Arrow keys move focus between tabs; Enter activates (Base UI tablist).
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Tiles' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Tiles' })).toHaveAttribute('aria-selected', 'true');
  });
});

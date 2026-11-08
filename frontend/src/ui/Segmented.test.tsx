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
  it('marks exactly the current option with aria-pressed inside a named group', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Library view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches by click and by keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true');
  });
});

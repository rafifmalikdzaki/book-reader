import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import DesignPage from './DesignPage';

describe('DesignPage', () => {
  it('renders every primitive section and opens a dialog and a rail', async () => {
    const user = userEvent.setup();
    render(<DesignPage />);
    for (const name of ['Dialog', 'Toast', 'Rail, usePanel, ResizableRail']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('dialog', { name: 'Which mind answers?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('complementary', { name: 'Ask the library' })).toBeVisible();
  });
});

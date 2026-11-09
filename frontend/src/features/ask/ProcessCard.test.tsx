import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ProcessCard } from './ProcessCard';

function renderCard(props: Partial<React.ComponentProps<typeof ProcessCard>> = {}) {
  return render(
    <MemoryRouter>
      <ProcessCard steps={[]} found={[]} thought="" elapsed={0} {...props} />
    </MemoryRouter>,
  );
}

describe('ProcessCard', () => {
  it('shows a placeholder headline before the first step', () => {
    renderCard();
    expect(screen.getByText('Searching the library…')).toBeInTheDocument();
    expect(screen.getByText('Agent active')).toBeInTheDocument();
  });

  it('lists steps, the documents they found, and the reasoning stream', () => {
    renderCard({
      step: 'Reading a.pdf page 4…',
      steps: ['Searching library for “sampling”…', 'Reading a.pdf page 4…'],
      found: [
        { book: 'a.pdf', page: 4, section: 'Monte Carlo', snippet: 'draw samples from p(x)' },
        { book: 'b.md', title: 'Notes on MCMC' },
      ],
      thought: 'Need the sampling chapter.',
      elapsed: 3.2,
    });
    fireEvent.click(screen.getByRole('button', { name: /Reading a\.pdf page 4/ }));
    const steps = within(screen.getByRole('list', { name: 'Steps taken' })).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(screen.getByText('2 steps · 2 passages found')).toBeInTheDocument();
    expect(screen.getByText('3.2s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'a.pdf · p.4 · § Monte Carlo' })).toHaveAttribute(
      'href',
      '/book/a.pdf#p4',
    );
    expect(screen.getByRole('link', { name: 'Notes on MCMC' })).toBeInTheDocument();
    expect(screen.getByText('draw samples from p(x)')).toBeInTheDocument();
    expect(screen.getByText('Need the sampling chapter.')).toBeInTheDocument();
  });

  it('starts collapsed with the headline and counts, and toggles the body open and closed', () => {
    renderCard({
      step: 'Reading a.pdf page 4…',
      steps: ['Reading a.pdf page 4…'],
      found: [{ book: 'a.pdf', page: 4 }],
      thought: 'Need the sampling chapter.',
    });
    const toggle = screen.getByRole('button', { name: /Reading a\.pdf page 4/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('1 step · 1 passage found');
    expect(screen.queryByRole('list', { name: 'Steps taken' })).not.toBeInTheDocument();
    expect(screen.queryByText('Need the sampling chapter.')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Steps taken' })).toBeInTheDocument();
    expect(screen.getByText('Need the sampling chapter.')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByRole('list', { name: 'Steps taken' })).not.toBeInTheDocument();
  });
});

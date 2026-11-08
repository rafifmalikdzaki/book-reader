import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';
import { ProgressBar } from './ProgressBar';
import { VisuallyHidden } from './VisuallyHidden';

describe('ProgressBar', () => {
  it('reports its value to assistive tech and sets the fill width', () => {
    render(<ProgressBar label="Reading progress" value={42} valueText="Page 42 of 100" />);
    const bar = screen.getByRole('progressbar', { name: 'Reading progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', 'Page 42 of 100');
    expect(bar.firstElementChild).toHaveStyle({ width: '42%' });
  });

  it('clamps out-of-range and non-finite values', () => {
    const { rerender } = render(<ProgressBar label="p" value={250} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar label="p" value={Number.NaN} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<ProgressBar label="p" value={5} max={20} />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '25%' });
  });
});

describe('EmptyState', () => {
  it('renders heading, copy, and actions', () => {
    render(
      <EmptyState variant="hero" title="Ask your library" actions={<button type="button">Summarise</button>}>
        Answers cite the book and page.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Ask your library' })).toBeInTheDocument();
    expect(screen.getByText('Answers cite the book and page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeInTheDocument();
  });

  it('is just a line of text in the inline variant', () => {
    render(<EmptyState>No books match this filter.</EmptyState>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('No books match this filter.')).toBeInTheDocument();
  });
});

describe('VisuallyHidden', () => {
  it('stays in the accessibility tree', () => {
    render(<VisuallyHidden>Skip details</VisuallyHidden>);
    expect(screen.getByText('Skip details')).toBeInTheDocument();
  });
});

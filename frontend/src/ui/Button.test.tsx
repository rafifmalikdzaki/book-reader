import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, buttonClassName } from './Button';
import { LinkButton } from './LinkButton';

describe('Button', () => {
  it('renders its label as a button that does not submit forms by default', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Nope' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes toggle state to assistive tech via aria-pressed and aria-expanded', () => {
    render(
      <>
        <Button variant="onDark" aria-pressed="true">
          Lamp
        </Button>
        <Button variant="ghost" aria-expanded="false">
          Notes
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Lamp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shares its look with links through buttonClassName', () => {
    render(<a href="/ask" className={buttonClassName('ghost', 'sm')}>Ask</a>);
    expect(screen.getByRole('link', { name: 'Ask' }).className).toContain('button');
  });
});

describe('LinkButton', () => {
  it('is a plain button that activates with the keyboard', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<LinkButton tone="danger" onClick={onClick}>Remove</LinkButton>);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('type', 'button');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

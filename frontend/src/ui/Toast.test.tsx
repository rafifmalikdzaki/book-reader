import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from './Toast';
import { useToast } from './useToast';

function Trigger({ message }: { message: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message)}>
      Fire
    </button>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('shows the message in a status region', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger message="Reindex complete." />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Fire' }));
    expect(screen.getAllByText('Reindex complete.').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('replaces the previous toast instead of stacking', async () => {
    const user = userEvent.setup();
    function Two() {
      const { toast } = useToast();
      return (
        <>
          <button type="button" onClick={() => toast('First')}>
            One
          </button>
          <button type="button" onClick={() => toast('Second')}>
            Two
          </button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'One' }));
    await user.click(screen.getByRole('button', { name: 'Two' }));
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getAllByText('Second').length).toBeGreaterThan(0);
  });

  it('dismisses itself after the legacy 2.6 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger message="Gone soon" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Fire' }));
    expect(screen.getAllByText('Gone soon').length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText('Gone soon')).not.toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeApi } from './fakeApi';
import { renderShell } from './testing';

beforeEach(() => {
  window.localStorage.clear();
  installFakeApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Lamp', () => {
  it('toggles body.lamp-off and remembers it under br-lamp', async () => {
    const user = userEvent.setup();
    const first = renderShell('/');
    const lamp = screen.getByRole('button', { name: 'Lamp' });
    expect(lamp).toHaveAttribute('aria-pressed', 'false');

    await user.click(lamp);
    expect(lamp).toHaveAttribute('aria-pressed', 'true');
    expect(document.body).toHaveClass('lamp-off');
    expect(window.localStorage.getItem('br-lamp')).toBe('on');
    first.unmount();
    expect(document.body).not.toHaveClass('lamp-off');

    // A fresh load restores the saved preference before the user touches anything.
    renderShell('/');
    expect(document.body).toHaveClass('lamp-off');
    expect(screen.getByRole('button', { name: 'Lamp' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Lamp' }));
    expect(document.body).not.toHaveClass('lamp-off');
    expect(window.localStorage.getItem('br-lamp')).toBe('off');
  });

  it('still works when storage throws', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderShell('/');
    await user.click(screen.getByRole('button', { name: 'Lamp' }));
    expect(document.body).toHaveClass('lamp-off');
    vi.restoreAllMocks();
  });

  it('switches between Daylit, Amber Study, and Midnight Baize atmospheres', async () => {
    const user = userEvent.setup();
    const first = renderShell('/');

    // Open atmosphere dropdown
    const menuTrigger = screen.getByRole('button', { name: /Select atmosphere/i });
    await user.click(menuTrigger);
    expect(await screen.findByRole('menu', { name: 'Reading atmosphere' })).toBeInTheDocument();

    // Select Midnight Baize
    const midnightBtn = await screen.findByRole('menuitemradio', { name: /Midnight Baize/i });
    await user.click(midnightBtn);

    expect(document.body).toHaveClass('lamp-off', 'atmosphere-midnight');
    expect(document.body).toHaveAttribute('data-atmosphere', 'midnight');
    expect(window.localStorage.getItem('br-lamp')).toBe('midnight');
    first.unmount();

    // Fresh load restores midnight preference
    renderShell('/');
    expect(document.body).toHaveClass('lamp-off', 'atmosphere-midnight');
    expect(document.body).toHaveAttribute('data-atmosphere', 'midnight');

    // Click menu trigger and select Daylit Paper
    await user.click(screen.getByRole('button', { name: /Select atmosphere/i }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Daylit Paper/i }));
    expect(document.body).not.toHaveClass('lamp-off');
    expect(document.body).not.toHaveClass('atmosphere-midnight');
    expect(document.body).toHaveAttribute('data-atmosphere', 'daylight');
    expect(window.localStorage.getItem('br-lamp')).toBe('off');
  });
});

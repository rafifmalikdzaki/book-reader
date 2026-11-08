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
});

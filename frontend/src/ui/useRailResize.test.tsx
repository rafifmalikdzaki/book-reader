import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RailResizeHandle } from './RailResizeHandle';
import { stubViewport } from './test-utils';
import { RAIL_STORAGE_KEY, useRailResize } from './useRailResize';

function Harness() {
  const resize = useRailResize();
  return (
    <div>
      <output data-testid="width">{resize.width}</output>
      <RailResizeHandle resize={resize} />
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.className = '';
});

describe('useRailResize', () => {
  it('exposes a focusable vertical separator with value bounds', () => {
    stubViewport(1280);
    render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Resize chat panel' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', '300');
    expect(handle).toHaveAttribute('aria-valuemax', '640');
    expect(handle).toHaveAttribute('aria-valuenow', '360');
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('resizes with the arrow keys, Home and End, clamped, and persists', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    render(<Harness />);
    const handle = screen.getByRole('separator');
    handle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '376');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', '344');
    await user.keyboard('{Home}');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    await user.keyboard('{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    await user.keyboard('{End}{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '640');
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe('640');
  });

  it('restores a stored width, clamped', () => {
    stubViewport(1280);
    window.localStorage.setItem(RAIL_STORAGE_KEY, '9000');
    render(<Harness />);
    expect(screen.getByTestId('width')).toHaveTextContent('640');
  });

  it('widens when dragged left and persists on release', async () => {
    stubViewport(1280);
    const user = userEvent.setup();
    render(<Harness />);
    const handle = screen.getByRole('separator');
    await user.pointer([
      { keys: '[MouseLeft>]', target: handle, coords: { clientX: 500 } },
      { coords: { clientX: 450 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(handle).toHaveAttribute('aria-valuenow', '410');
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe('410');
    expect(document.body).not.toHaveClass('rail-resizing');
  });

  it('renders no handle below 901px', () => {
    stubViewport(600);
    render(<Harness />);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('survives blocked storage', async () => {
    stubViewport(1280);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '376');
    vi.restoreAllMocks();
  });
});

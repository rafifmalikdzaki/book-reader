import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeApi } from './fakeApi';
import { useLibrarySearchParams } from './index';
import { SEARCH_DEBOUNCE_MS } from './SearchBox';
import { renderShell } from './testing';

function Library() {
  const { q, inside } = useLibrarySearchParams();
  return <output data-testid="params">{JSON.stringify({ q, inside })}</output>;
}

const box = () => screen.getByRole('searchbox');
const location = () => screen.getByTestId('location').textContent;
const params = () => screen.getByTestId('params').textContent;

beforeEach(() => {
  installFakeApi();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

describe('global search', () => {
  it('debounces typing into ?q= on the library without inside', async () => {
    const user = setup();
    renderShell('/', <Library />);
    await user.type(box(), 'sicp');
    expect(location()).toBe('/');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(location()).toBe('/?q=sicp');
    expect(params()).toBe('{"q":"sicp","inside":false}');
  });

  it('Enter on the library searches inside books immediately', async () => {
    const user = setup();
    renderShell('/', <Library />);
    await user.type(box(), 'monad{Enter}');
    expect(location()).toBe('/?q=monad&inside=1');
    expect(params()).toBe('{"q":"monad","inside":true}');
    // The pending debounce was cancelled; it must not downgrade to a title filter.
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(location()).toBe('/?q=monad&inside=1');
  });

  it('clearing the box removes the params', async () => {
    const user = setup();
    renderShell('/?q=old&inside=1', <Library />);
    expect(box()).toHaveValue('old');
    await user.clear(box());
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(location()).toBe('/');
  });

  it('Enter on another route navigates to the library with a full-text search', async () => {
    const user = setup();
    renderShell('/ask', <Library />);
    await user.type(box(), 'a b&c');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(location()).toBe('/ask');
    await user.type(box(), '{Enter}');
    expect(location()).toBe('/?q=a%20b%26c&inside=1');
    expect(box()).toHaveValue('a b&c');
  });

  it('ignores Enter on an empty box', async () => {
    const user = setup();
    renderShell('/ask');
    await user.type(box(), '   {Enter}');
    expect(location()).toBe('/ask');
  });

  it('replays an arriving ?q= into the input', () => {
    renderShell('/?q=%20graphs%20&inside=1', <Library />);
    expect(box()).toHaveValue('graphs');
    expect(params()).toBe('{"q":"graphs","inside":true}');
  });
});

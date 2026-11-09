import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useStickToBottom } from './useStickToBottom';

function Log({ signal, forceKey }: { signal: number; forceKey?: string | null }) {
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(signal, forceKey);
  return <div ref={ref} onScroll={onScroll} data-testid="log" />;
}

function mockGeometry(node: HTMLElement, scrollHeight: number) {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: 100 });
}

describe('useStickToBottom', () => {
  it('follows new content while the reader is at the bottom', () => {
    const { getByTestId, rerender } = render(<Log signal={0} />);
    const node = getByTestId('log');
    mockGeometry(node, 500);
    rerender(<Log signal={1} />);
    expect(node.scrollTop).toBe(500);
  });

  it('leaves the scroll position alone once the reader scrolled up', () => {
    const { getByTestId, rerender } = render(<Log signal={0} />);
    const node = getByTestId('log');
    mockGeometry(node, 1000);
    node.scrollTop = 100;
    act(() => {
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    rerender(<Log signal={1} />);
    expect(node.scrollTop).toBe(100);
  });

  it('re-pins to the bottom when the force key changes (new send)', () => {
    const { getByTestId, rerender } = render(<Log signal={0} forceKey={null} />);
    const node = getByTestId('log');
    mockGeometry(node, 1000);
    node.scrollTop = 100;
    act(() => {
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    rerender(<Log signal={1} forceKey="question" />);
    expect(node.scrollTop).toBe(1000);
  });

  it('follows again after the reader scrolls back near the bottom', () => {
    const { getByTestId, rerender } = render(<Log signal={0} />);
    const node = getByTestId('log');
    mockGeometry(node, 1000);
    node.scrollTop = 100;
    act(() => {
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    node.scrollTop = 850; // 1000 - 850 - 100 = 50px from the bottom
    act(() => {
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    rerender(<Log signal={1} />);
    expect(node.scrollTop).toBe(1000);
  });
});

import { vi } from 'vitest';

/** jsdom has no matchMedia. Stubs it so queries resolve through `viewport`. */
export function stubViewport(width: number): { set: (width: number) => void } {
  window.innerWidth = width;
  const listeners = new Set<{ query: string; notify: () => void }>();
  const matches = (query: string): boolean => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    if (min && width < Number(min[1])) return false;
    if (max && width > Number(max[1])) return false;
    return Boolean(min ?? max);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query);
    },
    media: query,
    addEventListener: (_: string, notify: () => void) => listeners.add({ query, notify }),
    removeEventListener: (_: string, notify: () => void) => {
      for (const entry of listeners) if (entry.notify === notify) listeners.delete(entry);
    },
  }));
  window.dispatchEvent(new Event('resize'));
  return {
    set(next) {
      width = next;
      window.innerWidth = next;
      for (const entry of listeners) entry.notify();
      window.dispatchEvent(new Event('resize'));
    },
  };
}

/** jsdom does no layout: fake the scroll geometry of every element. Returns a restore function. */
export function stubScrollGeometry(scrollHeight: number, clientHeight = 100): () => void {
  const spies = [
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight),
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}

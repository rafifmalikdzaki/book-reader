import { vi } from 'vitest';

/** jsdom has no matchMedia. Stubs it so queries resolve through `viewport`. */
export function stubViewport(width: number): { set: (width: number) => void } {
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
  return {
    set(next) {
      width = next;
      for (const entry of listeners) entry.notify();
    },
  };
}

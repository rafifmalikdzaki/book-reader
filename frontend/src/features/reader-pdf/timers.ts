type TimerId = ReturnType<typeof setTimeout>;

/** Tracks timeouts so one `clearAll` can cancel everything a binding scheduled. */
export interface Timers {
  later(fn: () => void, ms: number): TimerId;
  clear(id: TimerId | null | undefined): void;
  clearAll(): void;
}

export function createTimers(): Timers {
  const ids = new Set<TimerId>();
  return {
    later(fn, ms) {
      const id = setTimeout(() => {
        ids.delete(id);
        fn();
      }, ms);
      ids.add(id);
      return id;
    },
    clear(id) {
      if (id === null || id === undefined) return;
      clearTimeout(id);
      ids.delete(id);
    },
    clearAll() {
      ids.forEach((id) => clearTimeout(id));
      ids.clear();
    },
  };
}

import { postProgress } from '../../api/endpoints';
import { createTimers } from './timers';

/** Debounce window for reading-position writes (legacy `postProgress`). */
export const PROGRESS_DEBOUNCE_MS = 250;

export interface ProgressPoster {
  post(page: number): void;
  /** Sends the last pending page immediately (route unmount). */
  flush(): void;
}

/** Last-write-wins, 250ms-debounced `POST /api/progress` for one book. */
export function createProgressPoster(rel: string): ProgressPoster {
  const timers = createTimers();
  let pending: ReturnType<typeof timers.later> | null = null;
  let latest: number | null = null;
  const send = () => {
    if (latest === null) return;
    const page = latest;
    latest = null;
    postProgress({ path: rel, page }).catch(() => {});
  };
  return {
    post(page) {
      timers.clear(pending);
      latest = page;
      pending = timers.later(() => {
        pending = null;
        send();
      }, PROGRESS_DEBOUNCE_MS);
    },
    flush() {
      if (pending !== null) {
        timers.clear(pending);
        pending = null;
      }
      send();
    },
  };
}

import * as RadixToast from '@radix-ui/react-toast';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import styles from './Toast.module.css';
import { ToastContext, type ToastApi } from './useToast';

/** Legacy `Shell.toast` auto-hid after 2.6 seconds. */
export const TOAST_DURATION_MS = 2600;

interface Current {
  key: number;
  message: string;
  duration: number;
}

/** One bottom-centre toast at a time, like the legacy `#toast`. Mount once near the root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [open, setOpen] = useState(false);

  const toast = useCallback<ToastApi['toast']>((message, options) => {
    setCurrent((previous) => ({
      key: (previous?.key ?? 0) + 1,
      message,
      duration: options?.duration ?? TOAST_DURATION_MS,
    }));
    setOpen(true);
  }, []);
  const api = useMemo<ToastApi>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider duration={TOAST_DURATION_MS} swipeDirection="down" label="Notice">
        {children}
        {current ? (
          <RadixToast.Root
            key={current.key}
            open={open}
            onOpenChange={setOpen}
            duration={current.duration}
            className={styles.toast}
          >
            <RadixToast.Description>{current.message}</RadixToast.Description>
          </RadixToast.Root>
        ) : null}
        <RadixToast.Viewport label="Notifications" className={styles.viewport} />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

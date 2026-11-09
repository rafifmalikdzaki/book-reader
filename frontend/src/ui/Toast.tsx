import * as RadixToast from '@radix-ui/react-toast';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import styles from './Toast.module.css';
import { ToastContext, type ToastAction, type ToastApi } from './useToast';

/** Legacy `Shell.toast` auto-hid after 2.6 seconds. */
export const TOAST_DURATION_MS = 2600;

interface Current {
  key: number;
  message: string;
  duration: number;
  action?: ToastAction;
}

/** One bottom-centre toast at a time, like the legacy `#toast`. Mount once near the root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [open, setOpen] = useState(false);

  const toast = useCallback<ToastApi['toast']>((message, options) => {
    setCurrent((previous) => ({
      key: (previous?.key ?? 0) + 1,
      message,
      duration: options?.duration ?? (options?.action ? 5000 : TOAST_DURATION_MS),
      action: options?.action,
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
            <RadixToast.Description className={styles.description}>{current.message}</RadixToast.Description>
            {current.action ? (
              <RadixToast.Action asChild altText={current.action.altText ?? current.action.label}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    current.action?.onClick();
                    setOpen(false);
                  }}
                >
                  {current.action.label}
                </button>
              </RadixToast.Action>
            ) : null}
          </RadixToast.Root>
        ) : null}
        <RadixToast.Viewport label="Notifications" className={styles.viewport} />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

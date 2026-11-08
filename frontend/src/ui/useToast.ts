import { createContext, useContext } from 'react';

export interface ToastApi {
  /** Shows `message`, replacing any toast on screen (replaces legacy `Shell.toast`). */
  toast: (message: string, options?: { duration?: number }) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

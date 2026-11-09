import { createContext, useContext } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
  altText?: string;
}

export interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

export interface ToastApi {
  /** Shows `message`, replacing any toast on screen (replaces legacy `Shell.toast`). */
  toast: (message: string, options?: ToastOptions) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

import { type ReactNode } from 'react';

import { Button, type ButtonVariant } from './Button';
import { Dialog, DialogActions } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

/**
 * High-trust modal confirmation for destructive or high-stakes actions.
 * Replaces unstyled native `window.confirm()` popups.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      showClose={false}
      title={title}
      description={description}
    >
      <DialogActions>
        <Button variant="ghost" onClick={handleCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} loading={loading} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

import { Button, Dialog, DialogActions } from '../../ui';
import styles from './OrganizeDialog.module.css';

export interface OrganizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookCount: number;
  /** Disables the confirm button (request in flight or a run already going). */
  busy: boolean;
  error: string;
  onConfirm: () => void;
}

/** Confirmation before any excerpt leaves the machine (legacy `#organize-dialog` copy). */
export function OrganizeDialog({
  open,
  onOpenChange,
  bookCount,
  busy,
  error,
  onConfirm,
}: OrganizeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Auto-organize the library?"
      description={`Mistral will read the titles, PageIndex section headings, and short first-page excerpts for ${bookCount} books, then propose a category for each.`}
    >
      <p className={styles.note}>
        Files stay exactly where they are. Categories are virtual and follow each book by content,
        not file name. The excerpts are sent to Mistral only after you confirm.
      </p>
      <DialogActions>
        <Button onClick={onConfirm} disabled={busy}>
          Start sorting
        </Button>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </DialogActions>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

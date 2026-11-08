import { Button, Dialog, DialogActions } from '../../ui';

export type DeleteTarget = { kind: 'chat'; id: string } | { kind: 'project'; id: string; name: string };

/** Delete confirmation for a chat or a project (copy from the legacy `#delete-dialog`). */
export function ConfirmDelete({ target, onCancel, onConfirm }: {
  target: DeleteTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const project = target?.kind === 'project';
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => !open && onCancel()}
      size="sm"
      showClose={false}
      title={project ? 'Delete this project?' : 'Delete this chat?'}
      description={
        project
          ? `“${target.name}” will be removed. Its chats stay in Recent.`
          : 'This removes the transcript from this device. It cannot be undone.'
      }
    >
      <DialogActions>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm}>Delete</Button>
      </DialogActions>
    </Dialog>
  );
}

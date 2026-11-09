import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { createNotepadGroup, deleteNotepadGroup, getNotepad, notepadExportUrl } from '../../api/endpoints';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  LinkButton,
  Rail,
  RailBody,
  RailResizeHandle,
  usePanel,
  useRailResize,
  useToast,
} from '../../ui';
import { ComposeForm } from './ComposeForm';
import { NoteCard } from './NoteCard';
import styles from './Notepad.module.css';
import { NOTEPAD_KEY, useNotepadDraft } from './NotepadProvider';

/** Researcher notepad rail (`id="notepad"`): groups, notes, compose form, export links. */
export function NotepadRail() {
  const panel = usePanel('notepad');
  const resize = useRailResize({ storageKey: 'br-notepad-rail-width' });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { draft } = useNotepadDraft();
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState('');
  const [groupToDelete, setGroupToDelete] = useState<{ id: string; name: string; count: number } | null>(null);

  const snapshot = useQuery({ queryKey: NOTEPAD_KEY, queryFn: () => getNotepad() });
  const refetch = () => queryClient.invalidateQueries({ queryKey: NOTEPAD_KEY });

  const addGroup = useMutation({
    mutationFn: (groupName: string) => createNotepadGroup(groupName),
    onSuccess: () => {
      setName('');
      return refetch();
    },
    onError: (error) => toast(error.message),
  });
  const removeGroup = useMutation({
    mutationFn: (id: string) => deleteNotepadGroup(id),
    onSuccess: refetch,
    onError: () => toast('Could not delete the group.'),
  });

  const groups = snapshot.data?.groups ?? [];
  const notes = snapshot.data?.notes ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) addGroup.mutate(trimmed);
  };

  let content;
  if (snapshot.isPending) content = '…';
  else if (snapshot.isError) content = `Cannot load notes: ${snapshot.error.message}`;
  else if (!groups.length) content = <EmptyState>No groups yet.</EmptyState>;
  else {
    content = groups.map((group) => {
      const own = notes.filter((note) => note.group === group.id);
      return (
        <section key={group.id} className={styles.group}>
          <header className={styles.groupHead}>
            <h3 className={styles.groupTitle}>
              {group.name} ({own.length})
            </h3>
            {group.id !== 'inbox' ? (
              <LinkButton
                tone="danger"
                className={styles.groupDelete}
                aria-label={`Delete group ${group.name}`}
                onClick={() => setGroupToDelete({ id: group.id, name: group.name, count: own.length })}
              >
                Delete
              </LinkButton>
            ) : null}
          </header>
          {own.map((note) => (
            <NoteCard key={note.id} note={note} groups={groups} />
          ))}
        </section>
      );
    });
  }

  return (
    <Rail
      {...panel.railProps}
      label="Researcher notepad"
      title="Notes"
      closeLabel="Close notes"
      width={resize.width}
      handle={<RailResizeHandle resize={resize} label="Resize notepad panel" />}
      initialFocusRef={commentRef}
    >
      <RailBody>
        <form className={styles.groupForm} autoComplete="off" onSubmit={submit}>
          <Input
            className={styles.groupName}
            value={name}
            maxLength={120}
            placeholder="New group…"
            aria-label="New group name"
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="ghost" disabled={addGroup.isPending}>
            Add
          </Button>
        </form>
        {draft ? (
          <ComposeForm key={draft.seq} note={draft.note} groups={groups} commentRef={commentRef} />
        ) : null}
        <div aria-live="polite">{content}</div>
        <div className={styles.exports}>
          <a href={notepadExportUrl('markdown')} download>
            Export notes
          </a>
          <a href={notepadExportUrl('json')} download>
            JSON
          </a>
        </div>
      </RailBody>
      <ConfirmDialog
        open={groupToDelete !== null}
        onOpenChange={(open) => !open && setGroupToDelete(null)}
        title={groupToDelete ? `Delete group “${groupToDelete.name}”?` : 'Delete group?'}
        description={
          groupToDelete
            ? `This will permanently remove the group and its ${groupToDelete.count} ${groupToDelete.count === 1 ? 'note' : 'notes'}.`
            : ''
        }
        confirmLabel="Delete group"
        onConfirm={() => {
          if (groupToDelete) {
            removeGroup.mutate(groupToDelete.id);
            setGroupToDelete(null);
          }
        }}
      />
    </Rail>
  );
}

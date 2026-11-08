import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { deleteNote, updateNote } from '../../api/endpoints';
import type { NotepadGroup, NotepadNote, NotepadSnapshot } from '../../api/types';
import { LinkButton, Select, Textarea, useToast } from '../../ui';
import { bookFileName, locatorText, sourceHref } from './locators';
import styles from './Notepad.module.css';
import { NOTEPAD_KEY } from './NotepadProvider';

/** Legacy debounce between typing in an annotation and the PATCH. */
export const AUTOSAVE_MS = 700;

export function NoteCard({ note, groups }: { note: NotepadNote; groups: NotepadGroup[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const latest = useRef(note.comment);
  const saved = useRef(note.comment);
  const timer = useRef<number | null>(null);

  const save = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const comment = latest.current;
    if (comment === saved.current) return;
    const previous = saved.current;
    saved.current = comment;
    updateNote(note.id, { comment })
      .then((updated) => {
        queryClient.setQueryData<NotepadSnapshot>(NOTEPAD_KEY, (snapshot) =>
          snapshot
            ? { ...snapshot, notes: snapshot.notes.map((n) => (n.id === updated.id ? updated : n)) }
            : snapshot,
        );
      })
      .catch(() => {
        saved.current = previous;
        toast('Annotation not saved.');
      });
  }, [note.id, queryClient, toast]);

  // A pending autosave still goes out if the card unmounts.
  useEffect(() => save, [save]);

  const refetch = () => queryClient.invalidateQueries({ queryKey: NOTEPAD_KEY });

  return (
    <div className={styles.card}>
      <blockquote className={styles.quote}>{note.quote}</blockquote>
      <span className={styles.locator}>
        <Link to={sourceHref(note)}>
          {bookFileName(note.book)} · {locatorText(note)}
        </Link>
      </span>
      <Textarea
        className={styles.annotation}
        aria-label="Annotation"
        placeholder="Annotation…"
        defaultValue={note.comment}
        onChange={(event) => {
          latest.current = event.target.value;
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(save, AUTOSAVE_MS);
        }}
        onBlur={save}
      />
      <div className={styles.actions}>
        <Select
          controlSize="sm"
          className={styles.move}
          aria-label="Move note to group"
          value={note.group}
          onChange={(event) => {
            updateNote(note.id, { group: event.target.value })
              .then(refetch)
              .catch(() => toast('Could not move the note.'));
          }}
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        <LinkButton
          tone="danger"
          aria-label="Delete note"
          onClick={() => {
            if (!window.confirm('Delete this note?')) return;
            deleteNote(note.id)
              .then(() => {
                toast('Note deleted.');
                return refetch();
              })
              .catch(() => toast('Could not delete the note.'));
          }}
        >
          Delete
        </LinkButton>
      </div>
    </div>
  );
}

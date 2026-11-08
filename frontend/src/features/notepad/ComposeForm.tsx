import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';

import { createNote } from '../../api/endpoints';
import type { NotepadGroup } from '../../api/types';
import { Button, Select, Textarea, useToast } from '../../ui';
import { bookFileName } from './locators';
import styles from './Notepad.module.css';
import { NOTEPAD_KEY, useNotepadDraft, type NoteDraft } from './NotepadProvider';

function clearSelection() {
  window.getSelection()?.removeAllRanges();
}

function locatorLine(note: NoteDraft): string {
  const parts = [bookFileName(note.book)];
  if (note.page) parts.push(`p.${note.page}`);
  if (note.section) parts.push(`§ ${note.section}`);
  if (note.paragraph) parts.push(`¶ ${note.paragraph}`);
  return parts.filter(Boolean).join(' · ');
}

/** The "new note from selection" form at the top of the rail. */
export function ComposeForm({
  note,
  groups,
  commentRef,
}: {
  note: NoteDraft;
  groups: NotepadGroup[];
  commentRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { cancel } = useNotepadDraft();
  const [comment, setComment] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => commentRef.current?.focus(), [commentRef]);

  const save = () => {
    if (saving) return;
    setSaving(true);
    createNote({ ...note, group: group ?? groups[0]?.id ?? '', comment })
      .then(() => {
        cancel();
        clearSelection();
        toast('Note saved.');
        return queryClient.invalidateQueries({ queryKey: NOTEPAD_KEY });
      })
      .catch((error: unknown) => {
        setSaving(false);
        toast(error instanceof Error ? error.message : 'Could not save the note.');
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  };

  return (
    <section className={styles.compose} aria-label="New note">
      <div className={styles.composeLocator}>{locatorLine(note)}</div>
      <blockquote className={styles.composeQuote}>
        {String(note.quote || '').replace(/\s+/g, ' ').slice(0, 600)}
      </blockquote>
      <Textarea
        ref={commentRef}
        className={styles.composeComment}
        aria-label="Comment"
        placeholder="Why does this matter? (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composeActions}>
        <Select
          aria-label="Group"
          value={group ?? groups[0]?.id ?? ''}
          onChange={(event) => setGroup(event.target.value)}
        >
          {groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button disabled={saving} onClick={save}>
          Save note
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            cancel();
            clearSelection();
          }}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

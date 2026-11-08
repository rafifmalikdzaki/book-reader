import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { getChatOptions, reindexLibrary, setChatOptions } from '../api/endpoints';
import { Button, Dialog, DialogActions, DialogSection, Field, Select, useToast } from '../ui';
import styles from './OptionsDialog.module.css';

/** Query keys shared with the chat agents. */
export const CHAT_OPTIONS_KEY = ['chat', 'options'] as const;
export const CHAT_STATUS_KEY = ['chat', 'status'] as const;
export const CHAT_KEY = ['chat'] as const;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Model choice for Ask plus the Reindex action (legacy `#options-dialog`). */
export function OptionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Which mind answers?"
      description="Applies to Ask. Auto walks the provider chain."
    >
      {/* Mounted only while open, so every open starts with fresh form state. */}
      <OptionsContent onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function OptionsContent({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [choice, setChoice] = useState<string | null>(null);

  const options = useQuery({ queryKey: CHAT_OPTIONS_KEY, queryFn: () => getChatOptions() });
  const save = useMutation({
    mutationFn: (model: string) => setChatOptions(model),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHAT_KEY });
      onClose();
    },
  });
  const reindex = useMutation({
    mutationFn: () => reindexLibrary(),
    onSuccess: async (report) => {
      toast(report.notice || 'Reindex complete.');
      // Moved books change paths and note locations; let every page refetch.
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      await queryClient.invalidateQueries({ queryKey: ['notepad'] });
    },
  });

  const selected = choice ?? options.data?.selected ?? 'auto';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(selected);
  };

  const reindexStatus = reindex.isPending
    ? 'Reindexing…'
    : reindex.isError
      ? messageOf(reindex.error, 'Reindex failed')
      : reindex.isSuccess
        ? reindex.data.notice || 'Everything is up to date.'
        : '';
  const loadError = options.isError ? 'Options unavailable.' : null;
  const saveError = save.isError ? messageOf(save.error, 'Cannot save the selection') : null;

  return (
    <>
      <form onSubmit={submit}>
        <Field label="Chat model" hideLabel>
          {(control) => (
            <Select
              {...control}
              controlSize="lg"
              value={selected}
              disabled={options.isPending}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="auto">Auto — follow the provider chain</option>
              {(options.data?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.provider} · {model.model}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {loadError || saveError ? (
          <p role="alert" className={styles.error}>
            {loadError ?? saveError}
          </p>
        ) : null}
        <DialogActions>
          <Button type="submit" disabled={save.isPending || options.isPending}>
            Save
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
      </form>
      <DialogSection title="Library">
        <p className={styles.copy}>
          Move or rename books freely. Reindex follows the file content, not its name, so notes
          and places stay attached.
        </p>
        <Button variant="ghost" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
          Reindex library
        </Button>
        <span className={styles.status} role="status">
          {reindexStatus}
        </span>
      </DialogSection>
    </>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { importPaper } from '../../api/endpoints';
import { Button, Dialog, DialogActions, Field, Input } from '../../ui';
import { bookPath } from './bookLinks';
import { KEYWORDS_KEY } from './useBookMeta';
import { LIBRARY_KEY } from './useLibraryData';

export interface AddPaperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Fetch an open-access paper by DOI or arXiv id into the library, then open it. */
export function AddPaperDialog({ open, onOpenChange }: AddPaperDialogProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');

  const add = useMutation({
    mutationFn: (value: string) => importPaper(value),
    onSuccess: async (paper) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: LIBRARY_KEY }),
        client.invalidateQueries({ queryKey: KEYWORDS_KEY }),
      ]);
      setIdentifier('');
      onOpenChange(false);
      void navigate(bookPath(paper.rel));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = identifier.trim();
    if (value && !add.isPending) add.mutate(value);
  };

  const failure = add.error
    ? add.error instanceof ApiError
      ? add.error.detail
      : add.error.message
    : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) add.reset();
        onOpenChange(next);
      }}
      title="Add a paper"
      description="Paste a DOI or an arXiv id. The open-access PDF is fetched from arXiv or the publisher and saved to Papers/ in your library, with its title, authors and keywords."
    >
      <form onSubmit={submit}>
        <Field label="DOI or arXiv id" error={failure} hint="For example 2403.04807 or 10.1038/s41586-021-03819-2">
          {(control) => (
            <Input
              {...control}
              name="identifier"
              autoComplete="off"
              spellCheck={false}
              placeholder="arXiv:2403.04807"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          )}
        </Field>
        <DialogActions>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={add.isPending} disabled={!identifier.trim()}>
            {add.isPending ? 'Fetching…' : 'Add to library'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

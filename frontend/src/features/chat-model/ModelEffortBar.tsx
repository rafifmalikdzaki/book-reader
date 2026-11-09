import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent } from 'react';

import { getChatOptions, setChatOptions } from '../../api/endpoints';
import { cx } from '../../ui/cx';
import styles from './ModelEffortBar.module.css';

const CHAT_OPTIONS_KEY = ['chat', 'options'] as const;
const CHAT_KEY = ['chat'] as const;

/** `default` sends no reasoning effort, which every provider accepts. */
export type EffortLevel = 'default' | 'low' | 'medium' | 'high';

interface Props {
  variant?: 'bar' | 'compact';
  className?: string;
}

export function ModelEffortBar({ variant = 'bar', className }: Props) {
  const queryClient = useQueryClient();
  const options = useQuery({
    queryKey: CHAT_OPTIONS_KEY,
    queryFn: () => getChatOptions(),
  });

  const save = useMutation({
    mutationFn: (payload: { model?: string; effort?: string }) => setChatOptions(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHAT_KEY });
    },
  });

  const selectedModel = options.data?.selected ?? 'auto';
  const selectedEffort = (options.data?.effort ?? 'default').toLowerCase() as EffortLevel;

  const isSaving = save.isPending;

  function handleModelChange(e: ChangeEvent<HTMLSelectElement>) {
    save.mutate({ model: e.target.value });
  }

  function handleEffortChange(effort: EffortLevel) {
    if (effort === selectedEffort) return;
    save.mutate({ effort });
  }

  function handleEffortSelect(e: ChangeEvent<HTMLSelectElement>) {
    save.mutate({ effort: e.target.value });
  }

  const models = options.data?.models ?? [];
  const isCompact = variant === 'compact';

  return (
    <div
      className={cx(styles.bar, isCompact && styles.compact, className)}
      role="region"
      aria-label="Chat model and effort settings"
    >
      <div className={styles.group}>
        <span className={styles.label} id="model-select-label">
          Model:
        </span>
        <div className={styles.selectWrap}>
          <select
            id="chat-model-select"
            aria-labelledby="model-select-label"
            className={cx(styles.modelSelect, isCompact && styles.compactSelect)}
            value={selectedModel}
            disabled={!options.data?.available || isSaving}
            onChange={handleModelChange}
          >
            <option value="auto">Auto (Primary: Mercury 3)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? m.model} ({m.provider})
              </option>
            ))}
          </select>
          <span className={styles.selectChevron} aria-hidden="true">
            ▼
          </span>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.label} id="effort-label">
          Effort:
        </span>
        {isCompact ? (
          <div className={styles.selectWrap}>
            <select
              aria-labelledby="effort-label"
              className={styles.compactSelect}
              value={selectedEffort}
              disabled={isSaving}
              onChange={handleEffortSelect}
            >
              <option value="default">Default</option>
              <option value="low">Low (Fastest)</option>
              <option value="medium">Medium</option>
              <option value="high">High (Deep)</option>
            </select>
            <span className={styles.selectChevron} aria-hidden="true">
              ▼
            </span>
          </div>
        ) : (
          <div className={styles.effortGroup} role="group" aria-labelledby="effort-label">
            <button
              type="button"
              className={styles.effortBtn}
              aria-pressed={selectedEffort === 'default'}
              disabled={isSaving}
              onClick={() => handleEffortChange('default')}
              title="Default: let the model decide, works with every provider"
            >
              Default
            </button>
            <button
              type="button"
              className={styles.effortBtn}
              aria-pressed={selectedEffort === 'low'}
              disabled={isSaving}
              onClick={() => handleEffortChange('low')}
              title="Low reasoning effort: fast and direct"
            >
              Low
            </button>
            <button
              type="button"
              className={styles.effortBtn}
              aria-pressed={selectedEffort === 'medium'}
              disabled={isSaving}
              onClick={() => handleEffortChange('medium')}
              title="Medium reasoning effort: balanced explanation"
            >
              Medium
            </button>
            <button
              type="button"
              className={styles.effortBtn}
              aria-pressed={selectedEffort === 'high'}
              disabled={isSaving}
              onClick={() => handleEffortChange('high')}
              title="High reasoning effort: deep proofs and thorough derivation"
            >
              High
            </button>
          </div>
        )}
        {isSaving ? <span className={styles.savingIndicator}>Saving…</span> : null}
      </div>
    </div>
  );
}

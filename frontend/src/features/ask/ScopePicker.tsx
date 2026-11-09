import type { CategoryRecord } from '../../api/types';
import { SmartLink, bookHref } from '../chat-render';
import styles from './AskPage.module.css';

interface Props {
  categories: CategoryRecord[];
  /** Selected category ids (unknown ids are ignored). */
  selected: string[];
  locked: boolean;
  activeBook?: string | null;
  activePage?: number | null;
  onChange: (ids: string[]) => void;
}

/** Category scope (`#scope-picker`): "All books" is the empty selection, plus active filter pills. */
export function ScopePicker({
  categories,
  selected,
  locked,
  activeBook,
  activePage,
  onChange,
}: Props) {
  const known = new Set(categories.map((category) => category.id));
  const chosen = new Set(selected.filter((id) => known.has(id)));
  const chosenRecords = categories.filter((c) => chosen.has(c.id));
  const names = chosenRecords.map((c) => c.name);
  const label = categories.length && names.length ? names.join(', ') : 'All books';

  function toggle(id: string) {
    if (locked) return;
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    onChange(categories.filter((category) => next.has(category.id)).map((category) => category.id));
  }

  const readerHref = activeBook
    ? bookHref({ book: activeBook, page: activePage ?? null })
    : null;
  const shortBook = activeBook ? (activeBook.split('/').pop() ?? activeBook) : null;

  return (
    <div className={styles.scope}>
      <div className={styles.scopeRow}>
        <details id="scope-picker">
          <summary>
            Categories: <b title={label}>{label}</b>
          </summary>
          <div className={styles.scopeMenu}>
            <label className={styles.all}>
              <input
                type="checkbox"
                checked={chosen.size === 0}
                onChange={() => !locked && chosen.size > 0 && onChange([])}
              />
              All books
            </label>
            {categories.map((category) => (
              <label key={category.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(category.id)}
                  onChange={() => toggle(category.id)}
                />
                {category.name}
              </label>
            ))}
            {categories.length ? null : (
              <p className={styles.scopeEmpty}>No categories yet. All books are searched.</p>
            )}
          </div>
        </details>
        {chosenRecords.map((cat) => (
          <button
            key={cat.id}
            type="button"
            disabled={locked}
            className={styles.scopeChip}
            aria-label={`Remove category filter ${cat.name}`}
            onClick={() => toggle(cat.id)}
          >
            <span>{cat.name}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {shortBook && readerHref ? (
          <SmartLink href={readerHref} className={styles.bookScopeChip}>
            <span>Reading: {shortBook}{activePage ? ` · p.${activePage}` : ''}</span>
            <span aria-hidden="true">↗</span>
          </SmartLink>
        ) : null}
      </div>
    </div>
  );
}

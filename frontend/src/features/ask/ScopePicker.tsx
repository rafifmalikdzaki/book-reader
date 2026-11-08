import type { CategoryRecord } from '../../api/types';
import styles from './AskPage.module.css';

interface Props {
  categories: CategoryRecord[];
  /** Selected category ids (unknown ids are ignored). */
  selected: string[];
  locked: boolean;
  onChange: (ids: string[]) => void;
}

/** Category scope (`#scope-picker`): "All books" is the empty selection. */
export function ScopePicker({ categories, selected, locked, onChange }: Props) {
  const known = new Set(categories.map((category) => category.id));
  const chosen = new Set(selected.filter((id) => known.has(id)));
  const names = categories.filter((c) => chosen.has(c.id)).map((c) => c.name);
  const label = categories.length && names.length ? names.join(', ') : 'All books';

  function toggle(id: string) {
    if (locked) return;
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    onChange(categories.filter((category) => next.has(category.id)).map((category) => category.id));
  }

  return (
    <div className={styles.scope}>
      <details id="scope-picker">
        <summary>
          Categories: <b title={label}>{label}</b>
        </summary>
        <div className={styles.scopeMenu}>
          <label className={styles.all}>
            <input type="checkbox" checked={chosen.size === 0} onChange={() => !locked && chosen.size > 0 && onChange([])} />
            All books
          </label>
          {categories.map((category) => (
            <label key={category.id}>
              <input type="checkbox" checked={chosen.has(category.id)} onChange={() => toggle(category.id)} />
              {category.name}
            </label>
          ))}
          {categories.length ? null : (
            <p className={styles.scopeEmpty}>No categories yet. All books are searched.</p>
          )}
        </div>
      </details>
    </div>
  );
}

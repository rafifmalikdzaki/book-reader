import type { CategoryOption } from '../../api/types';
import { Button, Segmented, Select } from '../../ui';
import styles from './LibraryHead.module.css';
import type { GroupBy } from './grouping';
import type { LibraryView } from './useLibraryView';

const VIEW_OPTIONS = [
  { value: 'list', label: 'List' },
  { value: 'tiles', label: 'Tiles' },
] as const;

const GROUP_LABELS: Record<GroupBy, string> = {
  category: 'Group by category',
  tag: 'Group by tag',
  collection: 'Group by Zotero collection',
};

export interface LibraryHeadProps {
  categories: CategoryOption[];
  category: string;
  onCategory: (id: string) => void;
  /** Facets that have data; `category` is always offered. */
  groupOptions: GroupBy[];
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  organizeAvailable: boolean;
  onOrganize: () => void;
  /** Live status text ("Sorting 3 / 40…", "Categories ready.", ...). */
  organizeText: string;
}

export function LibraryHead({
  categories,
  category,
  onCategory,
  groupOptions,
  groupBy,
  onGroupBy,
  view,
  onView,
  organizeAvailable,
  onOrganize,
  organizeText,
}: LibraryHeadProps) {
  return (
    <div className={styles.head}>
      <h2 id="library-heading" className={styles.heading}>
        Library
      </h2>
      <Select
        id="category-filter"
        aria-label="Filter by category"
        className={styles.category}
        value={category}
        onChange={(event) => onCategory(event.target.value)}
      >
        <option value="">All categories</option>
        {categories.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
      {groupOptions.length > 1 && view === 'tiles' ? (
        <Select
          aria-label="Group books by"
          className={styles.category}
          value={groupBy}
          onChange={(event) => onGroupBy(event.target.value as GroupBy)}
        >
          {groupOptions.map((option) => (
            <option key={option} value={option}>
              {GROUP_LABELS[option]}
            </option>
          ))}
        </Select>
      ) : null}
      <Segmented label="Library view" options={VIEW_OPTIONS} value={view} onChange={onView} />
      {organizeAvailable ? (
        <Button variant="ghost" size="sm" onClick={onOrganize}>
          Auto-organize
        </Button>
      ) : null}
      <span className={styles.status} role="status">
        {organizeText}
      </span>
    </div>
  );
}

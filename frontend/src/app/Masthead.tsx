import { Link, NavLink } from 'react-router-dom';

import { IconButton, usePanel } from '../ui';
import { LampToggle } from './LampToggle';
import styles from './Masthead.module.css';
import { SearchBox } from './SearchBox';
import { useChromeState } from './ShellChrome';

const OPTIONS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </svg>
);

/**
 * Sticky top bar: brand, research tools (Notes; Ask link or reader chat toggle), global
 * search, lamp and options. On phones it wraps and the search takes its own row.
 */
export function Masthead({
  bookRoute,
  onOpenOptions,
}: {
  /** On /book/* the Ask entry toggles the reader chat rail instead of linking to /ask. */
  bookRoute: boolean;
  onOpenOptions: () => void;
}) {
  const notepad = usePanel('notepad');
  const chat = usePanel('chat');
  const contents = usePanel('contents');
  const { contentsAvailable } = useChromeState();

  return (
    <header className={styles.masthead}>
      <Link className={styles.wordmark} to="/">
        book<span>·</span>reader
      </Link>
      <nav className={styles.nav} aria-label="Research tools">
        {contentsAvailable ? (
          <button id="contents-toggle" type="button" className={styles.phoneOnly} {...contents.toggleProps}>
            Outline
          </button>
        ) : null}
        <button id="notepad-toggle" type="button" {...notepad.toggleProps}>
          Notes
        </button>
        {bookRoute ? (
          <button id="chat-toggle" type="button" {...chat.toggleProps}>
            Ask
          </button>
        ) : (
          <NavLink id="ask-link" to="/ask" end>
            Ask
          </NavLink>
        )}
      </nav>
      <div className={styles.tools}>
        <SearchBox />
        <LampToggle />
        <IconButton
          id="options-toggle"
          tone="onDark"
          icon={OPTIONS_ICON}
          label="Options"
          aria-haspopup="dialog"
          onClick={onOpenOptions}
        />
      </div>
    </header>
  );
}

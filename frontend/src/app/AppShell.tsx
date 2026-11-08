import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { ChatRail } from '../features/chat-rail';
import { NotepadProvider, NotepadRail } from '../features/notepad';
import { PanelProvider, ToastProvider, cx, usePanels } from '../ui';
import styles from './AppShell.module.css';
import { BookContextProvider } from './BookContext';
import { Masthead } from './Masthead';
import { OptionsDialog } from './OptionsDialog';
import { ShellChromeProvider, useChromeState } from './ShellChrome';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Library',
  '/ask': 'Ask',
  '/design': 'Design',
};

/** Layout route: masthead, stage (`<Outlet/>`), notepad and reader-chat rails, options dialog. */
export function AppShell() {
  return (
    <ToastProvider>
      <PanelProvider>
        <BookContextProvider>
          <ShellChromeProvider>
            <NotepadProvider>
              <Shell />
            </NotepadProvider>
          </ShellChromeProvider>
        </BookContextProvider>
      </PanelProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const bookRoute = pathname.startsWith('/book/');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { close } = usePanels();
  const { stage, setContentsHost } = useChromeState();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  // A legacy navigation was a full page load, which closed every rail.
  useEffect(() => close(undefined, { silent: true }), [pathname, close]);

  useEffect(() => {
    // BookPage owns the title while a book is open; it restores the prior title on leave.
    const title = ROUTE_TITLES[pathname];
    if (title) document.title = `${title} — book-reader`;
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [pathname]);

  useEffect(() => () => { document.title = 'book-reader'; }, []);

  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <Masthead bookRoute={bookRoute} onOpenOptions={() => setOptionsOpen(true)} />
      <div className={styles.workspace}>
        <div ref={setContentsHost} className={styles.contentsHost} />
        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          data-stage={stage ?? undefined}
          className={cx(styles.stage, (stage === 'pdf' || stage === 'ask') && styles.flush)}
        >
          <Outlet />
        </main>
        <NotepadRail />
        {bookRoute ? <ChatRail /> : null}
      </div>
      <OptionsDialog open={optionsOpen} onOpenChange={setOptionsOpen} />
    </>
  );
}

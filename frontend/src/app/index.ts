/**
 * Shell hooks for feature code. Deliberately does not export AppShell/App (those import
 * features, and features import this file); the router imports `./AppShell` directly.
 */
export { BookContextProvider, useBookContext, useSetBookContext } from './BookContext';
export type { BookContextData, BookContextValue } from './BookContext';
export { ContentsPortal, useShellChrome, useStage } from './ShellChrome';
export type { Stage } from './ShellChrome';
export { useLibrarySearchParams } from './useLibrarySearchParams';
export type { LibrarySearchParams } from './useLibrarySearchParams';
export { CHAT_KEY, CHAT_OPTIONS_KEY, CHAT_STATUS_KEY } from './OptionsDialog';

import type { ChatSource } from '../../api/types';

import { ContextCards } from './agent/ContextCards';

/** Citation cards back into the reader (`book.pdf#p12`, `notes.md#L40`). */
export function SourceList({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;
  return <ContextCards sources={sources} />;
}

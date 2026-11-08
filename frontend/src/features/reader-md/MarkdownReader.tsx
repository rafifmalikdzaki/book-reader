import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getMarkdown } from '../../api/endpoints';
import { useSetBookContext, useStage } from '../../app';
import { BookErrorView } from '../reader/BookErrorView';
import { MarkdownView } from './MarkdownView';

/** Markdown book page (`/book/<rel>.md`): fetches the rendered document and its outline. */
export function MarkdownReader({ path }: { path: string }) {
  useStage('md');
  const setBookContext = useSetBookContext();
  useEffect(() => {
    setBookContext({ book: path, page: null });
    return () => setBookContext(null);
  }, [path, setBookContext]);

  // gcTime 0: the saved scroll ratio is read once per visit, so a revisit must refetch it.
  const { data, error } = useQuery({
    queryKey: ['markdown', path],
    queryFn: ({ signal }) => getMarkdown(path, { signal }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (error) return <BookErrorView error={error} />;
  if (!data) return null;
  return <MarkdownView key={data.rel} doc={data} />;
}

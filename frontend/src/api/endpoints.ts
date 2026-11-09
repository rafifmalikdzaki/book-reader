/**
 * One typed async function per backend JSON endpoint.
 *
 * Plain functions over `client.ts` (no React): TanStack Query hooks wrap these in
 * the feature folders. Errors surface as `ApiError` with the HTTP `status`.
 */
import { apiGet, apiSend, type RequestOptions } from './client';
import type {
  BookResponse,
  ChatAskBody,
  ChatAskResponse,
  ChatMessageResponse,
  ChatMode,
  ChatOptions,
  ChatOptionsSaved,
  ChatProject,
  ChatProjectsResponse,
  ChatSession,
  ChatSessionCreate,
  ChatSessionPatch,
  ChatSessionsResponse,
  ChatStatus,
  IndexRebuildResponse,
  IndexStatus,
  LibraryResponse,
  MarkdownResponse,
  NotepadExport,
  NotepadExportFormat,
  NotepadGroup,
  NotepadGroupDeleted,
  NotepadNote,
  NotepadNoteBody,
  NotepadNotePatch,
  NotepadSnapshot,
  OkResponse,
  OrganizeBody,
  OrganizeStartResponse,
  OrganizeStatus,
  PagesResponse,
  ProgressBody,
  ProgressResponse,
  ReindexReport,
  SearchResponse,
} from './types';

const enc = encodeURIComponent;

/* ---- library and books ------------------------------------------------ */

/** Note: consumes the one-time `relocation_notice` (see `LibraryResponse`). */
export function getLibrary(options?: RequestOptions): Promise<LibraryResponse> {
  return apiGet<LibraryResponse>('/api/library', options);
}

/** `page` overrides the saved page in the returned `viewer_url` (deep links). */
export function getBook(
  path: string,
  page?: number,
  options?: RequestOptions,
): Promise<BookResponse> {
  return apiGet<BookResponse>('/api/book', { ...options, query: { path, page } });
}

export function getMarkdown(path: string, options?: RequestOptions): Promise<MarkdownResponse> {
  return apiGet<MarkdownResponse>('/api/book/markdown', { ...options, query: { path } });
}

export function getProgress(path: string, options?: RequestOptions): Promise<ProgressResponse> {
  return apiGet<ProgressResponse>('/api/progress', { ...options, query: { path } });
}

/** Send `page` for PDFs or `scroll` (0..1) for Markdown. */
export function postProgress(body: ProgressBody, options?: RequestOptions): Promise<{ ok: true }> {
  return apiSend<{ ok: true }>('POST', '/api/progress', body, options);
}

export function getPages(options?: RequestOptions): Promise<PagesResponse> {
  return apiGet<PagesResponse>('/api/pages', options);
}

/** Library-wide search, or in-book search when `path` is given. */
export function search(
  q: string,
  opts: { path?: string; limit?: number } = {},
  options?: RequestOptions,
): Promise<SearchResponse> {
  return apiGet<SearchResponse>('/api/search', {
    ...options,
    query: { q, path: opts.path, limit: opts.limit },
  });
}

/** Absolute-path helpers for non-JSON resources. */
export const thumbUrl = (path: string, width = 300): string =>
  `/thumb.jpg?path=${enc(path)}&width=${width}`;
export const rawUrl = (path: string): string => '/raw/' + path.split('/').map(enc).join('/');

/* ---- organize and indexing ------------------------------------------- */

export function getOrganizeStatus(options?: RequestOptions): Promise<OrganizeStatus> {
  return apiGet<OrganizeStatus>('/api/organize/status', options);
}

/** Starts sorting (202). Throws `ApiError` 409 if already running, 503 if unconfigured. */
export function startOrganize(
  body: OrganizeBody = { confirm: true },
  options?: RequestOptions,
): Promise<OrganizeStartResponse> {
  return apiSend<OrganizeStartResponse>('POST', '/api/organize', body, options);
}

export function reindexLibrary(options?: RequestOptions): Promise<ReindexReport> {
  return apiSend<ReindexReport>('POST', '/api/library/reindex', undefined, options);
}

export function getIndexStatus(options?: RequestOptions): Promise<IndexStatus> {
  return apiGet<IndexStatus>('/api/index/status', options);
}

export function rebuildIndex(force = false, options?: RequestOptions): Promise<IndexRebuildResponse> {
  return apiSend<IndexRebuildResponse>('POST', '/api/index/rebuild', undefined, {
    ...options,
    query: { force },
  });
}

/* ---- chat: status, options, stateless ask ---------------------------- */

export function getChatStatus(options?: RequestOptions): Promise<ChatStatus> {
  return apiGet<ChatStatus>('/api/chat/status', options);
}

export function getChatOptions(options?: RequestOptions): Promise<ChatOptions> {
  return apiGet<ChatOptions>('/api/chat/options', options);
}

/** Set active model or reasoning effort. */
export function setChatOptions(
  choice: { model?: string; effort?: string } | string,
  options?: RequestOptions,
): Promise<ChatOptionsSaved> {
  const payload = typeof choice === 'string' ? { model: choice } : choice;
  return apiSend<ChatOptionsSaved>('POST', '/api/chat/options', payload, options);
}

/** Stateless ask used by the reader chat rail. */
export function askStateless(body: ChatAskBody, options?: RequestOptions): Promise<ChatAskResponse> {
  return apiSend<ChatAskResponse>('POST', '/api/chat', body, options);
}

/* ---- chat sessions and projects -------------------------------------- */

export function listChatSessions(options?: RequestOptions): Promise<ChatSessionsResponse> {
  return apiGet<ChatSessionsResponse>('/api/chat/sessions', options);
}

export function getChatSession(id: string, options?: RequestOptions): Promise<ChatSession> {
  return apiGet<ChatSession>(`/api/chat/sessions/${enc(id)}`, options);
}

export function createChatSession(
  body: ChatSessionCreate = {},
  options?: RequestOptions,
): Promise<ChatSession> {
  return apiSend<ChatSession>('POST', '/api/chat/sessions', body, options);
}

export function updateChatSession(
  id: string,
  patch: ChatSessionPatch,
  options?: RequestOptions,
): Promise<ChatSession> {
  return apiSend<ChatSession>('PATCH', `/api/chat/sessions/${enc(id)}`, patch, options);
}

export function deleteChatSession(id: string, options?: RequestOptions): Promise<OkResponse> {
  return apiSend<OkResponse>('DELETE', `/api/chat/sessions/${enc(id)}`, undefined, options);
}

/** Adds the user turn, runs retrieval + the model, returns the updated session. */
export function postMessage(
  sessionId: string,
  content: string,
  options?: Omit<RequestOptions, 'mode'> & { mode?: ChatMode },
): Promise<ChatMessageResponse> {
  const { mode, ...reqOptions } = options ?? {};
  const body = mode && mode !== 'teacher' ? { content, mode } : { content };
  return apiSend<ChatMessageResponse>(
    'POST',
    `/api/chat/sessions/${enc(sessionId)}/messages`,
    body,
    Object.keys(reqOptions).length ? reqOptions : undefined,
  );
}

export function cancelChatSession(
  sessionId: string,
  options?: RequestOptions,
): Promise<ChatMessageResponse> {
  return apiSend<ChatMessageResponse>(
    'POST',
    `/api/chat/sessions/${enc(sessionId)}/cancel`,
    undefined,
    options,
  );
}

export function listChatProjects(options?: RequestOptions): Promise<ChatProjectsResponse> {
  return apiGet<ChatProjectsResponse>('/api/chat/projects', options);
}

export function createChatProject(name: string, options?: RequestOptions): Promise<ChatProject> {
  return apiSend<ChatProject>('POST', '/api/chat/projects', { name }, options);
}

export function deleteChatProject(id: string, options?: RequestOptions): Promise<OkResponse> {
  return apiSend<OkResponse>('DELETE', `/api/chat/projects/${enc(id)}`, undefined, options);
}

/* ---- notepad ---------------------------------------------------------- */

export function getNotepad(
  filter: { group?: string; book?: string } = {},
  options?: RequestOptions,
): Promise<NotepadSnapshot> {
  return apiGet<NotepadSnapshot>('/api/notepad', { ...options, query: filter });
}

export function createNotepadGroup(name: string, options?: RequestOptions): Promise<NotepadGroup> {
  return apiSend<NotepadGroup>('POST', '/api/notepad/groups', { name }, options);
}

/** Also deletes every note in the group. */
export function deleteNotepadGroup(
  id: string,
  options?: RequestOptions,
): Promise<NotepadGroupDeleted> {
  return apiSend<NotepadGroupDeleted>('DELETE', `/api/notepad/groups/${enc(id)}`, undefined, options);
}

export function createNote(body: NotepadNoteBody, options?: RequestOptions): Promise<NotepadNote> {
  return apiSend<NotepadNote>('POST', '/api/notepad/notes', body, options);
}

export function updateNote(
  id: string,
  patch: NotepadNotePatch,
  options?: RequestOptions,
): Promise<NotepadNote> {
  return apiSend<NotepadNote>('PATCH', `/api/notepad/notes/${enc(id)}`, patch, options);
}

export function deleteNote(id: string, options?: RequestOptions): Promise<OkResponse> {
  return apiSend<OkResponse>('DELETE', `/api/notepad/notes/${enc(id)}`, undefined, options);
}

/** JSON export (the Markdown export is a download link: use `notepadExportUrl`). */
export function exportNotepadJson(group?: string, options?: RequestOptions): Promise<NotepadExport> {
  return apiGet<NotepadExport>('/api/notepad/export', {
    ...options,
    query: { format: 'json', group },
  });
}

export function notepadExportUrl(format: NotepadExportFormat, group?: string): string {
  const params = new URLSearchParams({ format });
  if (group) params.set('group', group);
  return `/api/notepad/export?${params.toString()}`;
}

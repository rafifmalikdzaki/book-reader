/**
 * Hand-written mirrors of every FastAPI JSON payload the app uses.
 *
 * Sources of truth (keep in sync when they change):
 *   - library / book / markdown / progress: `src/book_reader/routes_library.py`
 *   - search, pages, organize, index, chat (stateless), reindex: `src/book_reader/app.py`
 *   - notepad: `src/book_reader/routes_notepad.py` + `notepad.py`
 *   - chat sessions / projects: `src/book_reader/routes_chat_sessions.py` + `chats.py`
 *
 * Conventions: timestamps named `created` / `updated` / `started` / `*_at` are Unix
 * epoch seconds (float) unless the field says ISO; `null` is a real value the server
 * sends, so fields are optional (`?`) only where the server may omit them. Book paths
 * (`rel`) are POSIX paths relative to the library root and double as the `?path=` key.
 */

/** FastAPI error body (`{detail}`); `ApiError` in `client.ts` surfaces it. */
export interface ApiErrorBody {
  detail: string;
}

/** `kind` of a book on disk. */
export type BookKind = 'pdf' | 'md';

/* ------------------------------------------------------------------ */
/* Library index: GET /api/library                                     */
/* ------------------------------------------------------------------ */

/** One book row of the library. */
export interface LibraryBook {
  rel: string;
  /** Display title (PDF metadata / top section / Markdown H1 / file stem). */
  title: string;
  kind: BookKind;
  /** First folder of `rel`, or "Unfiled" for books at the library root. */
  shelf: string;
  category_id: string;
  category_name: string;
  /** PDFs only; `null` for Markdown and for unreadable PDFs. */
  page_count: number | null;
  /** Last saved PDF page, `null` when none. */
  page: number | null;
  /** 0..100 read progress (page / page_count, or scroll * 100). */
  percent: number;
  /** `/thumb.jpg?path=...&width=300` for PDFs, "" for Markdown. */
  thumb_url: string;
  /** "dd Mon, HH:MM" in server local time, or "—" when never opened. */
  last_read_label: string;
  /** ISO 8601 (server local offset) of the last progress write, `null` when never opened. */
  last_read_at: string | null;
  updated_label: string;
}

export interface LibraryGroup {
  id: string;
  name: string;
  books: LibraryBook[];
}

export interface CategoryOption {
  id: string;
  name: string;
}

/** Resume / recent card. */
export interface LibraryCard {
  rel: string;
  title: string;
  kind: BookKind;
  shelf: string;
  page: number | null;
  page_count: number | null;
  percent: number;
  /** Section title of the saved page (PDF, from cached section trees), else "". */
  section: string;
  /** "dd Mon, HH:MM", or "not started". */
  updated_label: string;
  updated_at: string | null;
}

/** Notepad excerpt shown under the resume card. */
export interface NotePreview {
  book: string;
  page: number | null;
  line_start: number | null;
  /** Whitespace-collapsed, max 220 chars. */
  quote: string;
  /** e.g. "p.12 · § Intro" or "L9-12". */
  locator: string;
}

export interface OrganizeStatus {
  available: boolean;
  /** Absent when the organizer is not configured. */
  running?: boolean;
  phase?: 'idle' | 'starting' | 'sections' | 'taxonomy' | 'assign' | 'done' | 'error';
  done?: number;
  total?: number;
  /** Non-empty only when phase is "error". */
  error?: string;
  started?: number;
  taxonomy?: CategoryRecord[];
  /** Number of books with a stored category assignment. */
  assignments?: number;
  /** Set only by GET /api/organize/status when the organizer is missing. */
  reason?: string;
}

export interface CategoryRecord {
  id: string;
  name: string;
  description: string;
}

/**
 * `relocation_notice` is CONSUMED by this call: the server clears it after returning
 * it, so a second request yields "". Keep the notice in component state (or disable
 * refetch-on-focus for this query) and never re-derive it from a refetch.
 * `GET /api/library` also runs a reindex (`reconciler.sync()`) before building.
 */
export interface LibraryResponse {
  /** Flat, sorted rows (category order if a taxonomy exists, else most recently read). */
  books: LibraryBook[];
  /** The same rows grouped by category, in display order. */
  groups: LibraryGroup[];
  category_options: CategoryOption[];
  organize_available: boolean;
  organize_status: OrganizeStatus;
  book_count: number;
  resume: LibraryCard | null;
  resume_notes: NotePreview[];
  /** Up to 3 cards after `resume`. */
  recent: LibraryCard[];
  /** One-time human message about moved/renamed books, "" when none. */
  relocation_notice: string;
}

/* ------------------------------------------------------------------ */
/* Book: GET /api/book, /api/book/markdown, /api/progress             */
/* ------------------------------------------------------------------ */

/** Saved reading position. PDFs use `page`, Markdown uses `scroll` (0..1). */
export interface ProgressState {
  page: number | null;
  scroll: number | null;
  /** Epoch seconds of the last write, `null` when nothing is saved. */
  updated: number | null;
}

/** GET /api/progress?path= */
export interface ProgressResponse extends ProgressState {
  path: string;
}

/** POST /api/progress body: send `page` (PDF, >= 1) or `scroll` (Markdown, 0..1). */
export interface ProgressBody {
  path: string;
  page?: number;
  scroll?: number;
}

/**
 * GET /api/book?path=&page=
 *
 * When `path` is gone but a reindex shows the book moved, the server answers 200 with
 * just `{redirect}` (the canonical new `rel`), not a 307: fetch would follow a 307
 * into the HTML shell. The SPA should `navigate('/book/' + redirect, {replace: true})`.
 * Missing -> 404, outside the library / not a book -> 400.
 */
export interface BookRedirect {
  redirect: string;
}

export interface BookDetail {
  kind: BookKind;
  /** Canonical path (same as the request when not redirected). */
  rel: string;
  title: string;
  /** PDF: current page, clamped to 1..page_count; `?page=` wins over saved progress. */
  page: number | null;
  /** PDF page count; `null` for Markdown or an unreadable PDF. */
  page_count: number | null;
  /** PDF.js viewer iframe URL incl. `#page=N`; `null` for Markdown or on error. */
  viewer_url: string | null;
  progress: ProgressState;
  /** Set (HTTP 200) when a PDF cannot be opened; render it inline. */
  error: string | null;
}

export type BookResponse = BookDetail | BookRedirect;

export function isBookRedirect(value: BookResponse): value is BookRedirect {
  return 'redirect' in value;
}

export interface MarkdownOutlineEntry {
  /** Heading depth 1..4. */
  level: number;
  title: string;
  /** 1-based source line; the rendered heading has `id="L<line>"`. */
  line: number;
}

/**
 * GET /api/book/markdown?path=
 * `html` is server-rendered and sanitised (raw HTML in the source is disabled), so it is
 * safe for dangerouslySetInnerHTML. Rendered blocks carry `id="L<n>"` line anchors.
 */
export interface MarkdownResponse {
  kind: 'md';
  rel: string;
  title: string;
  html: string;
  outline: MarkdownOutlineEntry[];
  progress: ProgressState;
  error: null;
}

/* ------------------------------------------------------------------ */
/* Search and pages: GET /api/search, /api/pages                      */
/* ------------------------------------------------------------------ */

export interface SearchHit {
  book: string;
  kind: BookKind;
  /** PDF hits. */
  page: number | null;
  /** Markdown hits (1-based source line). */
  line: number | null;
  line_end: number | null;
  section: string;
  snippet: string;
}

export type SearchBackend = 'local' | 'pageindex' | 'elasticsearch' | 'hybrid' | (string & {});

/** `kind` is the book's kind for in-book search, "library" for library-wide search. */
export interface SearchResponse {
  kind: BookKind | 'library';
  backend: SearchBackend;
  hits: SearchHit[];
}

/** GET /api/pages: page count per book, `null` for Markdown. Unreadable PDFs are omitted. */
export interface PagesResponse {
  counts: Record<string, number | null>;
}

/* ------------------------------------------------------------------ */
/* Organize: GET /api/organize/status, POST /api/organize            */
/* ------------------------------------------------------------------ */

export interface OrganizeBody {
  /** Must be `true`; the server answers 400 otherwise. */
  confirm: boolean;
  force_taxonomy?: boolean;
}

/** POST /api/organize -> 202. 409 when already running, 503 when not configured. */
export interface OrganizeStartResponse {
  started: true;
  status: OrganizeStatus;
}

/* ------------------------------------------------------------------ */
/* Library reindex and search index                                    */
/* ------------------------------------------------------------------ */

/** POST /api/library/reindex (and `ReindexReport.as_dict()`). */
export interface ReindexReport {
  /** old rel -> new rel for each moved book. */
  moved: Record<string, string>;
  conflicts: Record<string, string>[];
  added: number;
  missing: number;
  hashed: number;
  /** Path of the state backup taken for this reindex, if any. */
  backed_up: string | null;
  failed: string[];
  recovered: boolean;
  /** Human summary, "" when nothing happened. */
  notice: string;
}

export interface RebuildJobSnapshot {
  running: boolean;
  /** `{indexed, skipped, chunks}` once finished. */
  stats: Record<string, number> | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
}

/** GET /api/index/status */
export interface IndexStatus {
  elasticsearch: {
    url: string | null;
    index: string | null;
    available: boolean;
    reachable: boolean;
    chunks: number | null;
    job: RebuildJobSnapshot | null;
  };
  pageindex: { available: boolean; cached_books: number };
  search_backend: SearchBackend;
}

/** POST /api/index/rebuild?force= (503 when Elasticsearch is absent or unreachable). */
export interface IndexRebuildResponse {
  ok: true;
  /** `false` when a rebuild was already running. */
  started: boolean;
  job: RebuildJobSnapshot;
}

/* ------------------------------------------------------------------ */
/* Chat: options, status, stateless ask                               */
/* ------------------------------------------------------------------ */

/** One selectable provider/model; `id` is "<provider>:<model>". */
export interface ChatModelOption {
  id: string;
  provider: string;
  model: string;
}

/** GET /api/chat/status */
export interface ChatStatus {
  available: boolean;
  providers: ChatModelOption[];
  /** "auto" or a `ChatModelOption.id`. */
  selected: string;
  /** Present when chat is unavailable ("agent extra not installed"). */
  reason?: string;
}

/** GET /api/chat/options */
export interface ChatOptions {
  available: boolean;
  models: ChatModelOption[];
  selected: string;
}

/** POST /api/chat/options body; `model` "auto" clears the choice. 400 on unknown model. */
export interface ChatOptionsBody {
  model: string;
}

export interface ChatOptionsSaved {
  ok: true;
  selected: string;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/**
 * A citation attached to an answer. All fields are optional on the wire: PDF sources
 * carry `book` + `page` (+ `section`), Markdown sources `book` + `line` (+ `line_end`),
 * search-derived ones may add `snippet`.
 */
export interface ChatSource {
  book?: string;
  page?: number | null;
  line?: number | null;
  line_end?: number | null;
  section?: string;
  snippet?: string;
  [extra: string]: unknown;
}

/** POST /api/chat body (stateless, used by the reader rail). Max 50 messages of 8000 chars. */
export interface ChatAskBody {
  messages: ChatTurn[];
  book?: string | null;
  page?: number | null;
  /** Overrides the saved model for this request. */
  model?: string | null;
}

/** POST /api/chat. 400 bad input, 502 provider failed, 503 chat not configured. */
export interface ChatAskResponse {
  answer: string;
  sources: ChatSource[];
  provider: string;
  model: string;
  /** "extractive" when the model returned nothing and the answer is quoted from sources. */
  fallback?: string;
}

/* ------------------------------------------------------------------ */
/* Chat sessions and projects (Ask workspace)                         */
/* ------------------------------------------------------------------ */

export interface StoredMessage {
  id: string;
  role: ChatRole;
  content: string;
  sources: ChatSource[];
  /** Empty for user messages. */
  provider: string;
  model: string;
  created: number;
}

export interface ChatSession {
  id: string;
  title: string;
  created: number;
  updated: number;
  pinned: boolean;
  project_id: string | null;
  /** Book the session is anchored to, if any (follows moves). */
  book: string | null;
  page: number | null;
  /** Category ids scoping retrieval; empty means the whole library. */
  categories: string[];
  messages: StoredMessage[];
  status?: 'idle' | 'thinking' | 'error';
  thought_step?: string;
  last_error?: string | null;
}

export interface ChatProject {
  id: string;
  name: string;
  created: number;
}

/** GET /api/chat/sessions */
export interface ChatSessionsResponse {
  /** Sessions that are neither pinned nor in a project expire after this many days. */
  retention_days: number;
  /** Library categories available for scoping. */
  categories: CategoryRecord[];
  projects: ChatProject[];
  sessions: ChatSession[];
}

/** POST /api/chat/sessions -> 201. Unknown category -> 400, missing book -> 404. */
export interface ChatSessionCreate {
  book?: string | null;
  page?: number | null;
  categories?: string[];
}

/** PATCH /api/chat/sessions/{id}: send only the fields to change (>= 1). */
export interface ChatSessionPatch {
  title?: string;
  pinned?: boolean;
  /** `null` removes the session from its project. */
  project_id?: string | null;
  categories?: string[];
}

/** POST /api/chat/sessions/{id}/messages. 503 chat not configured, 502 provider failed. */
export interface ChatMessageBody {
  content: string;
}

export interface ChatMessageResponse {
  session: ChatSession;
}

export interface ChatProjectsResponse {
  projects: ChatProject[];
}

export interface OkResponse {
  ok: true;
}

/* ------------------------------------------------------------------ */
/* Notepad: /api/notepad/*                                            */
/* ------------------------------------------------------------------ */

/**
 * Notepad group. The server types these as `dict[str, object]`; the real fields
 * (from `NotepadStore`) are below. The "inbox" group always exists and cannot be deleted.
 */
export interface NotepadGroup {
  /** "inbox" or a 12-char hex id. */
  id: string;
  name: string;
  created: number;
}

/**
 * Notepad note (`dict[str, object]` on the server; fields from `NotepadStore.add_note`).
 * PDF notes carry `page` and char offsets into that page's text layer; Markdown notes
 * carry source line numbers and char offsets into the source file.
 */
export interface NotepadNote {
  /** 12-char hex id. */
  id: string;
  /** Group id. */
  group: string;
  /** Book `rel` (remapped automatically when the book moves). */
  book: string;
  kind: BookKind;
  /** Selected text, trimmed, max 8000 chars. */
  quote: string;
  /** PDF page (>= 1); `null` for Markdown. */
  page: number | null;
  /** Enclosing section title, "" when unknown (max 120 chars). */
  section: string;
  char_start: number | null;
  char_end: number | null;
  /** Markdown: source lines; PDF: text-layer line numbers when words were supplied. */
  line_start: number | null;
  line_end: number | null;
  /** PDF text-layer block index, when known. */
  paragraph: number | null;
  /** Max 8000 chars; "" when empty. */
  comment: string;
  created: number;
  updated: number;
}

/** GET /api/notepad?group=&book= (notes sorted by `created`). */
export interface NotepadSnapshot {
  groups: NotepadGroup[];
  notes: NotepadNote[];
}

/** POST /api/notepad/groups body (1..120 chars; duplicate name -> 400). Returns the group. */
export interface NotepadGroupBody {
  name: string;
}

/** DELETE /api/notepad/groups/{id}: also deletes the group's notes. */
export interface NotepadGroupDeleted {
  removed_notes: number;
}

/**
 * POST /api/notepad/notes body. `kind` must match the book. PDF notes need `page`;
 * optional `word_start`/`word_end` (text-layer word indices) let the server compute
 * `paragraph`, lines and char offsets. Markdown notes are located server-side by quote.
 * Empty `group` means the inbox. Returns the stored `NotepadNote`.
 */
export interface NotepadNoteBody {
  book: string;
  kind: BookKind;
  quote: string;
  group?: string;
  page?: number | null;
  section?: string;
  word_start?: number | null;
  word_end?: number | null;
  char_start?: number | null;
  char_end?: number | null;
  paragraph?: number | null;
  comment?: string;
}

/** PATCH /api/notepad/notes/{id}; returns the updated note. */
export interface NotepadNotePatch {
  comment?: string;
  group?: string;
}

export type NotepadExportFormat = 'markdown' | 'json';

/** GET /api/notepad/export?format=json. (`markdown` is a text/markdown download.) */
export interface NotepadExport {
  version: 1;
  exported: number;
  groups: NotepadGroup[];
  notes: NotepadNote[];
}

# ADR-005: Split Ask into a reader rail and a persistent workspace

## Status

Accepted

## Date

2026-11-08

## Context

The reader needs immediate questions about the current page without leaving the
book. The home page needs a conventional chat workspace where the user can find
older conversations, pin useful ones, and constrain retrieval to library
categories. Keeping a single client-only rail would lose history on reload;
making the reader rail fully persistent would add session UI to a surface built
for page context.

The library is local and has optional LLM providers. Retrieval can already use
the full library, but the user wants category-scoped attempts while the default
remains all books.

## Decision

- Keep the reader's Ask as a resizable right-side rail. It posts a stateless
  request with the current book and page and keeps only the in-page conversation.
- Add `/ask` as a persistent workspace. Sessions are stored in `chats.json`;
  each session keeps its messages, sources, book/page context, selected
  categories, pin state, and optional project.
- Sessions expire seven days after their last activity unless pinned or assigned
  to a chat project. Projects are virtual chat folders; deleting one unassigns
  its chats and refreshes their retention window.
- Category selection is a multi-select over the existing virtual taxonomy;
  empty selection means all books. The API turns it into an allowed-book set and
  the chat tools enforce that scope, not only the prompt.
- Chat projects are not library shelves and never move files.
- Answers are returned as one JSON response today; no token streaming.

## Alternatives Considered

### One persistent global chat only

Rejected: the reader would lose the low-friction page rail, and the home page
would still lack a session sidebar and project grouping.

### Make the reader rail persistent too

Rejected: page sessions would accumulate chat-session UI/state inside a narrow
rail; the workspace already provides that history.

### Store category membership by moving files into folders

Rejected: the library is user-managed, and content-hash identity plus virtual
categories preserve notes and state across moves.

### Retain all sessions indefinitely

Rejected: `chats.json` would grow without a bound and expose stale transcripts
forever. Seven days plus pin/project exemptions is an explicit local retention
policy.

## Consequences

- Two Ask APIs/routes exist: `/api/chat` for the rail and
  `/api/chat/sessions/...` for the workspace.
- Chat sessions participate in the reindex backup/remap for book/source paths
  and use the shared state lock.
- Pinned and project chats can grow indefinitely; the user can delete them or
  delete the project (which unassigns but preserves transcripts).
- Adding streaming later should reuse the same storage shape and validation
  rather than creating a third Ask surface.

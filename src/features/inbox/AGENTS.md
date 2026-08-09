# Inbox

Inbox runs durable background tasks without requiring a browser to stay attached. Each entry owns one ordinary managed session: the entry ID, session ID, workspace, transcript, status, and optional artifact all share the same identity.

## Domain model

An entry begins pending with only an ID and creation time. `send_to_inbox` may complete it once with a concise message and at most one artifact filename. The artifact is an ordinary file in the managed session workspace; Inbox stores only the filename needed to present it.

`model/` owns the entry and ingress schemas. `server/database.ts` owns Inbox rows. `server/index.ts` owns entry/session teardown and workspace publication, while `server/dispatcher.ts` owns dispatch and completion supervision. `server/functions.ts` is the validated RPC ingress used by Query mutations and matching server callers; `server/tools.ts` validates and handles the agent-only result operation. `routes/inbox.ts` owns the external JSON and multipart HTTP ingress used by the browser extension.

## Managed-session lifecycle

Dispatch creates the pending entry before starting its session, making ownership and running state visible to every client before delivery begins. The ordinary session runtime then owns execution and completion.

The Inbox supervisor applies only Inbox retention policy:

1. A clean completion that called `send_to_inbox` keeps the completed entry and managed session.
2. A clean completion without a reported result removes both the pending entry and session.
3. Failed work retains both so the user can inspect it.
4. User deletion removes the managed session before publishing entry deletion; session teardown removes any artifact with it.

## Client synchronization

Inbox entries remain one projection inside the canonical workspace query. The workspace server function composes `listInboxEntries()` with the other feature projections; workspace SSE events apply the same entry upsert/delete transitions between snapshots.

`inboxQueries` is the feature read API over that cache and orders running work before completed work. `inboxMutations` owns dispatch and deletion requests plus the immediate successful delete projection. Components own their mutation observers and retain only interaction state such as the composer draft, location choice, confirmation-dialog visibility, and selected artifact pane.

The Inbox pane may publish one artifact into the browser-local workspace surface. That pane topology is not server state: when the authoritative entry disappears, the mounted Inbox pane removes the now-invalid local publication.

## Boundaries and invariants

- The [Sessions runtime](../sessions/server/runtime/AGENTS.md) owns delivery, execution, completion, and transcript streaming. Inbox owns only supervision and retention policy.
- [`../../server/database.ts`](../../server/database.ts) owns the shared connection, [Sessions](../sessions/AGENTS.md) owns session teardown, and [Workspace](../../workspace/AGENTS.md) owns the aggregate projection. Inbox owns its rows and entry events.
- The [Sessions SDK boundary](../sessions/server/sdk/AGENTS.md) owns session-role instructions and tool selection. Inbox owns the `send_to_inbox` contract and handler.
- [Workspace](../../workspace/AGENTS.md) owns generic pane composition. Inbox owns the behavior of its pane and entries.
- Never create a second execution model or a second status source for Inbox work. Entry identity, session identity, and workspace session status must continue to agree.

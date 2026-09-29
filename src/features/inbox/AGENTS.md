# Inbox

Inbox runs background tasks through durable Inbox-owned Workers without requiring a browser to stay attached. Each entry is a projection of its Worker: the entry ID, Worker session ID, workspace, transcript, status, and optional artifact all share the same identity.

## Domain model

An entry's `kind` is `pending`, `result`, or `error`, derived when projecting Worker metadata.
It is not persisted and does not describe execution activity. A result always has a message and
may reference one artifact; an error carries only its error text.

An entry begins pending with the Worker's ID and creation time. `send_to_inbox` replaces its result metadata with a concise message and at most one artifact path relative to the Session's artifacts directory. The agent writes the file first; the tool verifies that it exists and attaches its path without rewriting it. Tool input and stored results use the same schema. It ends the current turn, but is not a write-once database operation. A later call replaces the message and artifact reference without changing identity or creation time. Omitting the artifact clears its reference, not the underlying session file.

A failed unreported task stores a small error in metadata. Its ordinary Session retains whatever
history the provider recorded; Inbox does not separately persist launch input or provide a retry flow.
An error before provider history exists may therefore have no recoverable input.

Unreadable stored results project an explicit error instead of rejecting the Inbox list.
They are not pending: they remain retained, expose no unvalidated artifact path, and link to their
backing Session for inspection or a correcting follow-up. Deleting one requires confirmation because
its stored artifact reference cannot be trusted. A valid result replacement clears the projected error
without modifying the original metadata during reads.

`model/` owns the entry and ingress schemas and projects validated result metadata from Workers.
`server/index.ts` uses the public Worker read, detail-update, metadata-initialization, and delete capabilities; Inbox has
no table or SQL. `server/dispatcher.ts` calls `spawnWorker` with the complete launch configuration,
Inbox ownership, and a retention callback.
Result writes acknowledge persistence without rebuilding an entry; reads own the Inbox projection.
`server/functions.ts` is the validated RPC ingress used by Query mutations and matching server
callers; `server/tools.ts` validates and handles the agent-only result operation. `routes/inbox.ts`
owns the external JSON and multipart HTTP ingress used by the browser extension.

## Managed-session lifecycle

Worker spawning returns an admission receipt after persisting ownership and registering Session
acquisition, without waiting for provider startup or execution. Inbox announces the committed change;
publication does not promise to precede provider startup. Workers owns startup,
cancellation, failure cleanup, and deletion; the ordinary session runtime owns execution and completion.

Workers invokes Inbox's retention callback with the latest stored Worker and its completion:

1. A clean completion with stored metadata returns true, retaining reported and unreadable results.
2. A clean completion without metadata returns false; Workers removes the pending entry and session.
3. Failed work retains both and reports an error when no result was published, including startup
   failures before provider history exists.
4. User deletion delegates to Workers; shared session teardown removes artifacts and ownership, then publishes entry deletion. Deleting the backing session through another entrypoint removes the same entry.

Retained work uses Sessions' ordinary 30-minute idle connection timeout. Inbox does not manage provider connections or maintain a separate completion waiter or registry.
Deliberate Worker cancellation bypasses Inbox retention policy.
Results replace Worker metadata; failures initialize it only when absent. The conditional SQL
update belongs to Workers and is atomic, so a failure cannot overwrite a reported or unreadable
result or recreate deleted ownership. Inbox needs no write queue or read-check-write recovery.
Once per process, a shared recovery promise marks unresolved submissions as interrupted before the
first Inbox list or new admission. All Inbox spawning passes through that gate, so recovery needs
no active-Worker scan or eager startup hook. Failed recovery can be retried. Existing outcomes are
left alone, and recovery never reruns work whose external effects may already have occurred.

## Client synchronization

`inboxQueries.list()` owns the Inbox list cache independently of workspace state. Its GET server
function projects retained Inbox Workers after recovery. The main route preloads it alongside other
feature catalogs. The existing workspace event connection routes `inbox.changed` to this query;
reconnect and visibility recovery invalidate it in parallel with the other catalogs.

`queryCache.ts` owns invalidation and immediate entry deletion. A change hint cancels an overlapping
read, including an initial fetch, before requesting current data. A deletion removes the cached row
and replaces any overlapping read so its older snapshot cannot restore the entry. No separate event
journal or connection is needed. Inactive queries become stale and reload when consumed.

Presentation combines entries with shared Worker and Session activity to order running work first
and show progress and unread state. An active Worker supplies startup progress; ordinary Session
activity covers later follow-ups. Inbox does not manufacture a Session running status.
`inboxMutations` owns dispatch and deletion requests plus the immediate successful delete projection.
Components retain only interaction state such as composer drafts, location choices, and dialog visibility.

The Inbox pane publishes one selected result into the browser-local workspace surface: an editor for
an artifact, or the backing Session for a message or error. Selecting the same row unlinks it;
selecting another replaces it. Inbox stays open, and mobile selection focuses the linked pane.
The mounted Inbox removes a publication when its authoritative entry disappears or its result no
longer matches that pane. Entry messages and pending titles render as static Markdown with independently
clickable links. Error text stays literal.

## Boundaries and invariants

- [Workers](../workers/AGENTS.md) owns persistence and lifecycle operations. Inbox owns result validation, retention policy, webhook ingress, and presentation; it never starts or deletes sessions directly.
- [Sessions](../sessions/AGENTS.md) sees Inbox work as ordinary managed Workers, not a separate session type. [Workspace](../workspace/AGENTS.md) routes the existing entry events to Inbox's cache; result updates do not change session classification.
- Inbox owns its role instructions and the `send_to_inbox` contract in `server/tools.ts`; application
  composition selects them for the [session provider boundary](../providers/INTEGRATION.md).
- [Workspace](../workspace/AGENTS.md) owns generic pane composition. Inbox owns the behavior of its pane and entries.
- Never create a second execution model or a second status source for Inbox work. Entry identity, session identity, and workspace session status must continue to agree.

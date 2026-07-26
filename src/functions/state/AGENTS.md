# Server State

Server state gives every session fact and resource one trustworthy owner, making reconnect, restart, cross-client synchronization, and deletion predictable. It is organized by authority, durability, and lifecycle rather than by UI screen. This folder owns the shared SQLite connection, SDK session handles and cold snapshots, session-owned resources, and workspace-wide coordination facts. Live transcript execution remains in the runtime; persisted conversation history remains in the Copilot SDK.

## State authority

| State                                                               | Authority                                       | Durability                           |
| ------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Session transcript and SDK metadata                                 | Copilot SDK history                             | Durable                              |
| Session artifact files                                              | Files under Copilot SDK session state           | Durable                              |
| Active reduced session, queue, replay, completion                   | `SessionStream`                                 | Process-local                        |
| SDK handles and idle reduced snapshots                              | Session registry and snapshot cache             | Process-local cache over SDK history |
| Automations, Inbox, settings, worktrees, worker ownership/retention | Shared SQLite database                          | Durable                              |
| Draft claims                                                        | Shared SQLite database                          | Durable                              |
| Draft prompts, running, unread, Hyper membership, artifact workers  | Workspace state                                 | Process-local                        |
| Custom artifact kinds and Inbox artifact files                      | `~/.toy-box/artifacts/` and `~/.toy-box/inbox/` | Durable files                        |

The central session invariant is simple: an active session takes its truth from the in-memory runtime; an idle session is reconstructed from persisted SDK history. A snapshot can avoid replay work, but it is never a second source of truth.

SQLite lives at `~/.toy-box/toy-box.sqlite`. It stores Toy Box metadata, not transcripts. The connection is shared across feature stores, while each owning subsystem controls its rows and lifecycle.

## Session lifecycle

The session registry coordinates the server-side lifecycle and resources of a session:

- SDK handles are cached and resumed single-flight. Short operations use one stale-handle retry; a `SessionStream` keeps one long-lived handle.
- Draft creation persists a claim and uses the SDK's experimental empty-session surface to create the workspace and optional artifact. Because that workspace has no resumable event history, the first message starts the turn-bearing session over it and records any existing artifact into ordinary SDK history before deleting the claim.
- Creation determines the session role, prepares its working directory or worktree, configures SDK tools and instructions, applies an optional SDK-managed friendly name before first-message delivery, consumes any durable draft claim, and publishes session-list metadata. Creation names remain eligible for later automatic title updates; only the explicit rename operation marks a name as user-owned.
- Idle snapshots replay SDK history through the canonical projector and reducer, then cache the result. Clean runtime completion refreshes that cache; abort and error paths do not cache potentially unpersisted state.
- Retained sessions are warmed on declaration and keep their cache slot through rotation, so the cap governs only the transient tail. Retention is a cache policy rather than a second authority: the snapshot cache knows which sessions are retained, and the workspace boundary decides that pinned sessions are the ones worth retaining.
- Worker ownership and worktrees are session-owned resources. A worktree is an optional isolated Git checkout whose checkout and SQLite row move together through creation, merge or apply, and deletion.
- Deletion recursively removes the complete worker tree, then the SDK session and its artifact files, live stream, cached handles, worktree and worker records, any pin naming it, workspace and snapshot state, before publishing the list deletion. A not-found SDK session still receives this local teardown so partially created and crash-abandoned workers cannot retain stale ownership records.

`SessionType` is derived from the record or relationship that manages a session, not stored as another session field. Automation, Inbox, worker, and Hyper managers are mutually exclusive; no manager means standard. The SDK guide owns how that role changes instructions and tools.

## Workspace state

`WorkspaceState` is the shared, client-facing projection of every workspace-wide fact that lives outside a session transcript. One pure reducer, `reduceWorkspaceState` (over the per-session `reduceWorkspaceSessionState`), builds it on both sides of the wire: the server reduces authoritative events into a process-local copy and broadcasts each accepted event over the shared update stream; every client reduces the same events into its hydrated Query cache. An event therefore means the same thing everywhere. The stream is at-most-once with no replay, so clients heal any gap by refetching the server's snapshot rather than replaying history.

The projection composes facts from several authorities without moving them: the process-local `sessionStates` map, hyper-session membership, and artifact-worker associations; the durable settings document, automation definitions, and Inbox entries owned by SQLite; the custom-artifact catalog on disk; and the passive server capabilities in `environment` (such as the terminal port). Each authority keeps its own durability and lifecycle — the snapshot only assembles a read-time view.

Its heart is the sparse `sessionStates` map, whose rows carry one session's lifecycle and optional draft prompt. Ordinary read-idle is represented by no row; a status exists only while there is something to remember:

- `draft`: a durably claimed session identity and SDK workspace that has not sent its first message
- `running`: server work is active
- `unread`: work finished without an active observer
- `idle`: no activity, but a draft prompt remains

Keeping these mutually exclusive in one state machine — instead of separate draft, running, and unread collections — is what lets one reducer serve the live server store and the browser identically. Server transitions publish only accepted changes. A client issues the subset it is allowed to: validated `WorkspaceAction`s, plus settings patches the server merges into the singleton document and re-publishes whole. It reduces its own action optimistically and repairs from a fresh snapshot if the RPC is rejected.

Two client caches consume the one stream. `useWorkspaceSync` is the single event sink; on connect it invalidates both the workspace snapshot and the durable session-list query, then feeds every event to both projections, each reducing the events it owns — nearly all belong to the workspace cache, while `session.upserted` and `session.deleted` drive the session list. A per-QueryClient journal reconciles the timing: it buffers events that arrive while a snapshot read is in flight — initial hydration, reconnect repair, rejected-action repair — so no transition is lost or replayed. Selectors then project a single slice — settings, automations, Inbox, or one session's status — so a component re-renders only for what it shows. Browser-local pane topology, focus, layout, and client identity remain separate authorities.

## Managed sessions and Inbox

A managed session is an ordinary runtime session whose lifecycle is governed by a product workflow rather than direct session-list interaction. Exactly one managing record or relationship—an automation definition, Inbox entry, Hyper membership, or worker record—identifies that policy without becoming another field on the session. The manager determines the session's `SessionType`, creation or reset behavior, retention, dedicated presentation, ownership transfer, and teardown. Its UI is an expression of that lifecycle: managed sessions stay out of the standard list and are opened, promoted, inspected, or deleted through their owning workflow.

An Inbox entry's ID is also its managed session ID. Inbox dispatch writes a pending row before delivery so every client can see the running task immediately. `send_to_inbox` completes that same row once with a concise message and optionally one artifact file at `~/.toy-box/inbox/<sessionId>/<filename>`. If the initial task finishes cleanly without completing the pending entry, it produced no Inbox result and the entry and session are removed together. Failed work retains its entry and session for inspection. Deleting a completed entry deletes its managed session and artifact directory as one lifecycle.

Hyper membership is process-local because it describes the current workspace presentation. Worker ownership is durable because parent deletion, session-role recovery, and restart cleanup depend on it. Automation and Inbox rows are durable and use the session ID as their own stable identity.

## Boundaries and invariants

- [`../runtime/AGENTS.md`](../runtime/AGENTS.md) owns live execution and idle/unread completion policy; state records its accepted lifecycle transitions.
- [`../sdk/AGENTS.md`](../sdk/AGENTS.md) owns raw SDK adaptation and role-specific configuration; the registry owns handles and application lifecycle.
- The top-level workspace and session server functions validate transport input and compose state operations. Storage facets remain private to this subsystem.
- Shared updates announce that state changed; they are not the state itself. Clients repair gaps from workspace snapshots, session queries, or SDK history.
- A resource with one semantic owner must have one teardown path. Do not make callers independently coordinate SDK sessions, database rows, worktrees, artifact files, or workspace projections.

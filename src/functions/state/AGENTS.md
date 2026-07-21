# Server State

Server state gives every session fact and resource one trustworthy owner, making reconnect, restart, cross-client synchronization, and deletion predictable. It is organized by authority, durability, and lifecycle rather than by UI screen. This folder owns the shared SQLite connection, SDK session handles and cold snapshots, session-owned resources, and workspace-wide coordination facts. Live transcript execution remains in the runtime; persisted conversation history remains in the Copilot SDK.

## State authority

| State                                                                | Authority                                       | Durability                           |
| -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Session transcript and SDK metadata                                  | Copilot SDK history                             | Durable                              |
| Session artifact files                                               | Files under Copilot SDK session state           | Durable                              |
| Active reduced session, queue, replay, completion                    | `SessionStream`                                 | Process-local                        |
| SDK handles and idle reduced snapshots                               | Session registry and snapshot cache             | Process-local cache over SDK history |
| Automations, Inbox, settings, worktrees, worker ownership/retention  | Shared SQLite database                          | Durable                              |
| Drafts, prompts, running, unread, Hyper membership, artifact workers | Workspace state                                 | Process-local                        |
| Custom artifact kinds and Inbox artifact files                       | `~/.toy-box/artifacts/` and `~/.toy-box/inbox/` | Durable files                        |

The central session invariant is simple: an active session takes its truth from the in-memory runtime; an idle session is reconstructed from persisted SDK history. A snapshot can avoid replay work, but it is never a second source of truth.

SQLite lives at `~/.toy-box/toy-box.sqlite`. It stores Toy Box metadata, not transcripts. The connection is shared across feature stores, while each owning subsystem controls its rows and lifecycle.

## Session lifecycle

The session registry coordinates the server-side lifecycle and resources of a session:

- SDK handles are cached and resumed single-flight. Short operations use one stale-handle retry; a `SessionStream` keeps one long-lived handle.
- Creation determines the session role, prepares its working directory or worktree, configures SDK tools and instructions, applies an optional SDK-managed friendly name before first-message delivery, promotes any draft, and publishes session-list metadata. Creation names remain eligible for later automatic title updates; only the explicit rename operation marks a name as user-owned.
- Idle snapshots replay SDK history through the canonical projector and reducer, then cache the result. Clean runtime completion refreshes that cache; abort and error paths do not cache potentially unpersisted state.
- Worker ownership and worktrees are session-owned resources. A worktree is an optional isolated Git checkout whose checkout and SQLite row move together through creation, merge or apply, and deletion.
- Deletion recursively removes the complete worker tree, then the SDK session and its artifact files, live stream, cached handles, worktree and worker records, workspace and snapshot state, before publishing the list deletion. A not-found SDK session still receives this local teardown so partially created and crash-abandoned workers cannot retain stale ownership records.

`SessionType` is derived from the record or relationship that manages a session, not stored as another session field. Automation, Inbox, worker, and Hyper managers are mutually exclusive; no manager means standard. The SDK guide owns how that role changes instructions and tools.

## Workspace state machine

The workspace snapshot composes shared facts needed across the client but keeps their server authorities intact. Its process-local core is a sparse `sessionStates` map whose rows carry one session's lifecycle and optional draft prompt. Ordinary read-idle is represented by no row; the explicit `idle` status exists only while a draft prompt must remain. Durable settings, automation definitions, and Inbox entries remain owned by SQLite but join that client projection. Settings form one typed aggregate persisted as a singleton JSON document; a complete replacement is committed before a `settings.changed` event publishes it. Artifact worker associations represent process-local queue admission and presentation before a worker session necessarily exists; they carry one source artifact, an optional friendly name, and opaque renderer metadata without duplicating durable worker ownership.

The valid statuses are:

- `draft`: a pre-persisted session identity that has not sent its first message
- `creating`: the atomic draft-to-persisted handoff; still draft-backed if creation fails, but treated as running by activity UI
- `running`: server work is active
- `unread`: work finished without an active observer
- `idle`: no activity, but a draft prompt remains

This sparse representation keeps mutually exclusive activity in one state machine instead of separate draft, running, and unread collections.

`reduceWorkspaceSessionState` is the canonical transition function shared by the process-local server store and browser projection. Draft creation and promotion, prompt edits, send failure, stream start and completion, read clearing, expiry, and deletion therefore mean the same thing on both sides. Server transition functions apply that reducer and publish only accepted changes to the shared update stream; draft expiry publishes the same discard transition as an explicit discard. Precise settings updates merge into the latest durable aggregate at this boundary, then publish the complete settings value so every client replaces it atomically.

Client-issued `WorkspaceAction`s and settings changes are optimistically reduced into the hydrated workspace Query cache and sent through validated workspace RPCs. `useWorkspaceSync` owns the single shared-event sink and invalidates both the workspace snapshot and durable session-list query when its SSE connection opens. The QueryClient-scoped query source journals events that race any authoritative workspace snapshot, including initial hydration, reconnect repair, and rejected-action repair. Query selectors project settings, automations, Inbox entries, or one session's status, activity, and prompt so consumers rerender only for the state they render. Browser-local pane topology, focus, layout preferences, and client identity remain separate authorities.

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

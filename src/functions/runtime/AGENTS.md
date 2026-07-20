# Session Runtime

The session runtime lets agent work outlive the browser that started it while remaining observable from every connected client. It supports immediate streaming, late joins, cursor reconnects, queued follow-ups, and headless execution without changing the underlying session model. To provide that continuity, it owns each live execution lifetime, reduced session state, queue, completion, and event fan-out. Connected UI, headless RPCs, automations, and model-facing tools all converge here.

## Session operations

The end-to-end session domain has five operation families. Create, deliver, spawn, and observe converge on the runtime; individual control commands retain their specific owners:

1. **Create** a session through its required first message. Toy Box exposes no operation for creating an empty persisted session.
2. **Deliver** a message to an existing session. The runtime decides whether it starts immediately or queues behind active execution.
3. **Spawn a worker** as a parent-owned session for delegated or focused work. The runtime inherits parent execution context, applies an optional friendly name before delivering the task, waits for that exact execution, and either retains or deletes the worker according to its declared policy.
4. **Observe** through a live event stream, a reduced snapshot, or a completion result.
5. **Control** by renaming, aborting, cancelling queued input, deleting, or applying worktree operations.

Control is a category, not one runtime method. Abort and queue cancellation act on live execution; rename, deletion, and worktree commands delegate through the session API to the registry or resource owner described in the state guide.

Resume is not a separate operation. Delivering to an idle session resumes its persisted SDK session; delivering to an active session queues. Likewise, callers never choose between send and queue.

`streamSession` is the connected composite: it registers observation before delivering an optional message, preventing a fast first event from falling between separate requests. The same request can create a session with its required first message, deliver to an existing session, or observe without delivering. Headless callers express their intent directly: `createSession` creates through the required first message, `deliverSessionMessage` sends or queues a message for an existing session, `spawnWorker` supervises a parent-owned session through completion and conditional teardown, and `stopWorker` covers both its spawning and running phases.

## Live execution

`SessionStream` names the live runtime for one session, not the event stream a client reads. It owns the SDK handle, canonical state, queued messages, completion waiters, and replayable event bus for that execution lifetime.

A worker does not add another execution mode to `SessionStream`. Its durable worker record owns the parent relationship and a boolean retention policy. `spawnWorker` composes worker creation, inherited context, an exact completion receipt, a stop guard that closes the race before the stream exists, and registry-owned deletion when `retained` is false. `create_session` uses the same supervisor with `retained: true` because its session remains the asynchronous result and follow-up channel; artifact work accepts the disposable default. Startup sweeps only disposable workers abandoned by a previous process and does not resume their execution.

Inbox dispatch, automation scheduling, and worker spawning each own a session supervisor because their terminal policies differ: Inbox preserves reported results, automations record run metadata, and the worker supervisor applies the worker's retention policy. The runtime centralizes their common mechanism by returning one exact completion receipt; manager-specific finalization stays with the manager rather than entering a generic policy abstraction.

1. Acquisition is single-flight. A caller joins an existing stream, shares an in-progress creation, creates a new SDK session, or resumes an idle session from its reduced snapshot and SDK handle.
2. Connected callers subscribe before delivery. `SessionStream.deliver` starts the message synchronously when idle or emits `message_queued`; repeated delivery of the same message ID returns the original disposition.
3. The SDK projector translates raw events into canonical `SessionEvent`s. The event bus stamps a process-monotonic `eventId`; the runtime stamps each SDK agent-loop segment with a `turnId`, distinct from the delivered message ID; and the shared reducer returns the next immutable `Session`.
4. When the SDK session reports idle, the runtime drains the next queued message through the same path. `assistant.turn_end` closes only an agent-loop segment and does not drain the queue. With no queued work, the runtime caches its clean final snapshot and closes.
5. Every real close publishes a terminal `end` event before releasing listeners, replay, queue state, and the live registry. Transport close means only that no more bytes are available; consumers reason about the domain event.

A delivery receipt exposes the initial `started` or `queued` decision and a waiter bound to that exact stream instance. Completion reports `completed`, `failed`, or `timed_out`, plus the latest substantive assistant response when available. Observation by session ID falls back to the final snapshot when no live stream remains.

## Observation and client orchestration

The per-session event bus provides bounded cursor replay and live fan-out. It registers a subscriber immediately, before iteration begins, so synchronous producers cannot outrun subscription. Existing subscribers retain pending events when future replay is cleared between message deliveries; clients that miss more than the retained window recover from the authoritative detail snapshot.

Subscriptions are either `active` or `passive`. Both receive the same live data. Active observation acknowledges that the user is watching, so a clean finish becomes idle; a stream that finishes without an active observer becomes unread. Passive previews stay live without suppressing that unread transition.

`useSession` is the browser orchestration boundary for one pane. It hydrates an idle snapshot, attaches while visible, reduces incoming events, batches rapid text deltas to animation frames, and detaches immediately when the pane closes or the page becomes hidden. Detaching stops only that client's observation. Aborting is a separate control that stops server work. `SessionPane` composes this lifecycle with transcript presentation, linked panes, and the composer without owning runtime policy.

## Realtime planes

Toy Box keeps two event planes separate because they promise different things:

| Plane                | Contract                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Session event stream | One session, ordered canonical events, cursor replay, multi-client fan-out, and terminal `end`                                |
| Shared update stream | `WorkspaceEvent` hints, at-most-once delivery, no replay, and repair through authoritative snapshots or React Query refetches |

Transcript continuity belongs to the session event stream. Drafts, running and unread state, Inbox entries, session-list metadata, and automation changes belong to the shared update plane. The `/api/workspace` SSE transport carries one `WorkspaceEvent` algebra, while client-issued `WorkspaceAction`s are commands sent through RPC. Broadcast is its internal fan-out mechanism, not another protocol; one failed client listener cannot fail the producing operation or interrupt the other clients. Do not add transcript replay semantics to broadcast or use broadcast as session truth.

## Boundaries and invariants

- The top-level session server functions validate transport input and delegate. Runtime policy belongs here, SDK translation belongs in [`../sdk/AGENTS.md`](../sdk/AGENTS.md), and authority or teardown belongs in [`../state/AGENTS.md`](../state/AGENTS.md).
- [`../../lib/session/sessionReducer.ts`](../../lib/session/sessionReducer.ts) is the one transition function for live server state, SDK history replay, browser streaming, and reconnect replay. Adding a second event interpretation path is an architectural regression.
- Session deletion delegates complete resource teardown to the state registry; runtime callers must not release stream state or adjacent resources independently.
- Process-wide registries survive development module reloads but not process restart. Durable recovery comes from SDK history, SQLite metadata, and files, never from replay buffers or cached handles.

# Session Runtime

A session is Toy Box's core compute primitive: an addressable agent process that can outlive the browser that started it, receive queued messages, and serve multiple subscribers and callers. Its durable identity, provider history, workspace, and owned resources survive individual executions; `SessionExecution` is the one live incarnation currently processing that session's mailbox. This resembles the Erlang/Elixir process model as an architectural analogy, not as an implementation claim about isolation or fault tolerance.

The end user directly supervises an ordinary session. Managed features instead govern sessions they own. Every waiter uses the same session completion mechanism; a supervisor is distinguished by lifecycle authority, not a special kind of wait. It owns admission, concurrency, context, cancellation, recovery, and what to retain, delete, record, or publish when execution ends. The runtime supplies the common process mechanics and exact execution receipts without defining a generic supervisor abstraction.

```mermaid
flowchart TB
    User[End user] --> Operations
    User --> Streaming
    Caller[App, session, or other caller] --> Streaming
    Caller --> Waiting

    subgraph Supervisors[Managed feature]
        Owner[Scenario owner]
        Policy[Ownership, concurrency, recovery, and terminal policy]
        Owner --> Policy
    end

    Policy --> Operations
    Policy --> Waiting

    subgraph Runtime[Shared session runtime]
        Operations[Create, recreate, deliver, and abort]
        Streaming[Stream a session]
        Waiting[Wait for completion]
        Process[SessionExecution: mailbox, state, events, exact completion]
        Operations --> Process
        Process --> Streaming
        Process --> Waiting
    end

    Process <--> Provider[Session provider and durable history]
```

## Session operations

The runtime exposes the session operations directly:

1. **Create** provider history through the first message. A draft already owns a public ID and optional files, and creation binds its ID to the selected provider without changing workspace identity.
2. **Recreate** a session through a new first message, retaining its public ID. `recreateSession` takes the same message and creation options as `createSession`: it privately deletes the previous session and its resources, publishes a fresh draft, then creates through the normal provider path. The caller chooses the new model, and the role resolves from the Session's ownership. A failed creation removes the replacement draft. Automations is the main consumer and owns its rule against overlapping runs.
3. **Deliver** a message to an existing session. The runtime decides whether it starts immediately or queues behind active execution; a queued user message may request immediate delivery.
4. **Subscribe** to a session from a revision: a replay or a snapshot brings the subscriber current, then live events follow.
5. **Wait** for completion. `waitForSessions` covers the announced, live, or latest persisted execution for each session ID; a delivery receipt binds a supervisor to the exact execution it started.
6. **Control** by renaming, steering or cancelling queued input, aborting, rewinding an idle conversation, deleting, or applying worktree operations.

Control is a category, not one runtime method. Abort, queue steering, and queue cancellation act on live execution; rename, deletion, and worktree commands delegate through the session API to the registry or resource owner described in the state guide. Rewind resolves the selected user-message timestamp against the provider's current rewind boundaries, removes that root user turn and every later conversation event while preserving files, and lets the provider reject a concurrent busy session. Queue status supplies the submission claim shared by normal draining and steering; steering uses the provider connection without opening another turn boundary.

Once a session has turn-bearing history, resume is not a separate operation. Delivering to an idle session resumes its persisted provider connection; delivering to an active session queues. Callers do not choose whether a new turn starts or a message enters the active mailbox, though an active user delivery may request immediate dispatch.

Callers create, recreate, or deliver without subscribing, and subscribe separately. `subscribeToSession(sessionId, send, close, after?)` first brings the subscriber current from its revision, then sends live events until `end`. A live execution replays the events after a covered revision and sends `resumed`, or sends one `snapshot` of its latest state. With nothing live, an idle session whose snapshot revision equals `after` sends its current artifacts and `resumed`, any other gets the idle `snapshot`, a missing session gets `deleted`, and the subscription closes. A client that subscribes from the revision it held before delivering receives the whole turn, so a fast first event cannot fall between its two requests. Headless callers use `createSession`, `recreateSession`, `deliverSessionMessage`, and `waitForSessions` directly. Scenario supervisors compose those operations with their own policy.

## Live execution

`SessionExecution` is the live runtime for one session. It owns the provider connection instance, canonical state, queued messages, completion waiters, and event log for that execution lifetime.

A managed feature may run work before its execution exists. `expectSessionCompletion` lets that work's completion answer ID-based waits from before publication and retains its settlement briefly, so a caller cannot miss an execution that starts, finishes, and is deleted quickly. A later execution of the session replaces it for new waits. The [Workers feature](../../../workers/AGENTS.md) owns the admission and lifetime policy that uses this capability.

Managed features supervise sessions because their terminal policies differ. The runtime centralizes execution and exact completion; scenario-specific policy stays with its owner rather than entering an enum, strategy interface, or alternate execution model.

1. Acquisition is single-flight. Before a new execution acquires a provider connection, the registry refreshes
   configuration when its application-supplied lifetime requires it. This lets a Channel-owned Worker
   receive current identity and collaboration instructions between executions. Active delivery never
   refreshes that session. A caller joins an existing execution, shares an in-progress creation, creates a
   new provider connection, or resumes an idle session from its reduced snapshot and cached provider
   connection. Snapshot reads, subscriptions, and runtime status treat an in-progress acquisition as the
   current execution, so a session announced before its execution exists never reads as missing.
2. Connected callers subscribe after delivery, from the revision they held before it. Every logical message has a unique client ID; `SessionExecution.deliver` synchronously claims the first turn or emits `message_queued` behind active execution. A queue entry is `queued` while cancellable, `submitting` while its provider call is in flight, and `submitted` until the provider echoes it. Only queued user messages can be steered. Each provider associates native message identity with the client ID and adds it to canonical input events after filtering native subagent and skill inputs. That event removes a queued input, reconciles browser optimism when present, and otherwise appends normally.
3. Each provider translates raw events into canonical `SessionEvent`s. Runtime-generated turn-start status uses the same emission path. The event log stamps a process-monotonic `revision`, and the shared reducer returns the next immutable `SessionState`.
4. A `background` status means the assistant is ready while background work keeps execution alive. It drains queued messages without finishing the execution; later deliveries also drain while in that status. When the provider emits `end`, the runtime drains queued work and finishes if none remains. A `session_title_changed` event updates workspace metadata and does not enter transcript state or its event stream.
5. Finishing publishes one terminal `end`, caches the resulting clean state, becomes idle when aborted and unread otherwise, and then disposes the live runtime. Subscribers close on that `end`. Disposing resolves waiters, removes the provider listener, and removes the stream registry entry; finishing then returns the provider connection to the state registry's bounded idle cache. Aborting interrupts provider work and then finishes; session deletion aborts provider work and removes the live runtime without publishing ordinary idle/unread state.

Files observation has a server lifetime independent of execution. Its shared artifact watcher reports
changes beneath the Session storage root and supplies open editors. `refreshSessionArtifacts` updates an affected live
stream through canonical events containing the current file list; idle snapshots read the files when loaded.
Streams neither own filesystem watchers nor wait for artifact discovery at turn completion.

A delivery receipt exposes the initial `started` or `queued` decision and a waiter bound to that exact execution. Completion reports `completed`, `failed`, or `timed_out`, plus the latest substantive assistant response when available. Failed live completion also forwards the final assistant message's error, preserving partial output separately from the failure detail. Waiting by session ID also covers work announced before its execution exists and falls back to the final snapshot when no live execution remains. A timeout ends only that caller's wait; it does not abort the session or alter its supervisor's policy.

A supervisor that retains durable history but expects little immediate reuse may call
`releaseIdleSession` after completion. This disconnects only a session with no active execution;
ordinary bounded provider operations independently restart the idle window when they finish.

## Subscriptions and client orchestration

Each execution's event log retains a bounded tail of its events across turns and notifies listeners synchronously, so a subscriber that replays and then listens in one step cannot miss an event. Every `SessionState` carries a `revision`, the point in history it reflects: its last reduced event's revision, or the one stamped when it was rebuilt, and 0 before any. A cursor is covered when it is the log's floor (the revision of the state the execution started from: 0 when new, or the seed's revision when resumed) or a retained event's revision, and a covered cursor replays exactly what it missed. Any other cursor, or none, receives a snapshot of the execution's latest state instead, so a client that missed more than the retained window recovers within the subscription. Every idle snapshot rebuild takes a fresh revision, so a cursor matches only the snapshot it came from. A subscriber that arrives after its execution finished is brought current and then closes.

Every subscription receives the same live data, and none changes how execution finishes. A clean finish is always unread; the client that shows it acknowledges it with `markRead`, while a passive preview never does.

In the browser, a session's detail query subscribes to it while a visible pane watches it: each subscription brings the detail current from its revision, it subscribes again for each run the shared activity announces and for each stopped run, whose history can keep less than its live states showed, batches rapid text deltas to animation frames, and ends as soon as the last watcher closes or hides. Ending a subscription does not stop server work; aborting is the separate control that does. `useSession` derives one pane's view and commands from that query, and `SessionPane` composes it with transcript presentation, linked panes, and the composer without owning runtime policy.

## Realtime planes

Toy Box keeps two event planes separate because they promise different things:

| Plane                | Contract                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Session event stream | One session, a replay or snapshot from a revision, ordered canonical events, multi-client fan-out, and terminal `end`         |
| Shared update stream | `WorkspaceEvent` hints, at-most-once delivery, no replay, and repair through authoritative snapshots or React Query refetches |

Transcript continuity belongs to the session event stream. Drafts, running and unread state, Inbox entries, session-list metadata, and automation changes belong to the shared update plane. The `/api/workspace` SSE transport carries one `WorkspaceEvent` algebra, while clients change shared state through ordinary RPCs. Broadcast is its internal fan-out mechanism, not another protocol; one failed client listener cannot fail the producing operation or interrupt the other clients. Do not add transcript replay semantics to broadcast or use broadcast as session truth.

## Boundaries and invariants

- The top-level session server functions validate transport input and delegate. Runtime policy belongs here, Native translation belongs in [Providers](../../../providers/AGENTS.md), and authority or teardown belongs in [`../state/AGENTS.md`](../state/AGENTS.md).
- [`../../model/reducer.ts`](../../model/reducer.ts) is the one transition function for live server state, provider history replay, browser streaming, and reconnect replay. Adding a second event interpretation path is an architectural regression.
- Session deletion delegates complete resource teardown to the state registry; runtime callers must not release execution state or adjacent resources independently.
- Process-wide registries survive development module reloads but not process restart. Durable recovery comes from provider history, SQLite metadata, and files, never from replay buffers or cached provider connections.

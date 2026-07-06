This project is a full-stack web application built with Bun, TanStack Start/Router/Query, React, Tailwind, ShadCN, and the GitHub Copilot SDK.

## Architecture

Start with the subsystem that matches your change. These are the main layers that shape how Toy Box works end to end.

### Sessions

#### SDK -> Domain Projection

The projector translates raw SDK session events into the canonical `SessionEvent`s the rest of the app understands, with all SDK-specific policy (tool name aliases, omitted/translated/deferred tool calls, terminal dispositions) declared as tables at the top of the file. History replay is a thin adapter in front of the same projection: it resolves the three ways a persisted log differs from a live stream (committed messages instead of deltas, lifecycle records, no in-flight progress) and replays the log through the identical pipeline, so a reloaded transcript can never disagree with one a client watched stream in. Start here when you need to understand how SDK output becomes app state. Files: [`src/functions/sdk/projector.ts`](src/functions/sdk/projector.ts), [`src/functions/sdk/historyReplay.ts`](src/functions/sdk/historyReplay.ts), [`src/functions/sdk/attachments.ts`](src/functions/sdk/attachments.ts), [`src/functions/sdk/extractors.ts`](src/functions/sdk/extractors.ts)

#### Session Reducer

The session reducer is the single transition function for `Session` state, shared by the server's live stream, server-side history replay, and the client (both live SSE events and the buffered replay a late-connecting client catches up on). Because every consumer feeds it the same canonical `SessionEvent`s, a transcript renders identically whether it is watched live, reloaded, or reconnected to. It turns events into messages, streaming assistant output, queued prompts, todos, status transitions, and linked-session state. Start here when you need to understand what a session event means to session state. Files: [`src/lib/session/sessionReducer.ts`](src/lib/session/sessionReducer.ts)

#### Runtime Streams

The runtime owns sessions while they are alive. Users send messages; the runtime delivers them. Delivery creates or resumes the SDK session as needed, returns a receipt or throws, and decides whether the message opens a turn immediately or queues for the next one. A live stream runs turns, drains queued messages between turns, keeps the reduced session state, and publishes every canonical event through its internal stream buffer. Watchers subscribe with a cursor, live or reconnecting, and the buffer provides monotonic `eventId`s, bounded replay, and fan-out. Every stream ends by publishing a terminal `end` event before leaving the registry; transport close only means no more bytes. Start here when you need to understand delivery, active streams, reconnect, queueing, or completion. Files: [`src/functions/runtime/stream/index.ts`](src/functions/runtime/stream/index.ts), [`src/functions/runtime/stream/buffer.ts`](src/functions/runtime/stream/buffer.ts)

#### Realtime Sync and Query Cache

Toy Box has two server event planes. Session streams expose the per-session transcript/data plane: ordered, replayable, cursor-based subscriptions carrying canonical `SessionEvent`s for one active stream. Broadcast is the update plane for session and automation state: at-most-once SSE hints for lists and caches, with missed updates healed by React Query refetches. Keep these mechanisms separate: replay belongs to active session streams, while list/detail/automation cache synchronization belongs to broadcast + React Query. Start here when you need to understand how shared state propagates outside an active session stream. Files: [`src/functions/runtime/broadcast.ts`](src/functions/runtime/broadcast.ts), [`src/routes/api/events.ts`](src/routes/api/events.ts), [`src/hooks/events/useServerEvents.ts`](src/hooks/events/useServerEvents.ts), [`src/lib/session/queryCache.ts`](src/lib/session/queryCache.ts), [`src/hooks/automations/cache.ts`](src/hooks/automations/cache.ts), [`src/lib/queries.ts`](src/lib/queries.ts)

#### Session State Model

Session state in Toy Box combines persisted SDK-backed session history and metadata, live in-memory runtime state, and durable cached per-session side-state such as worktrees. The key rule is that active sessions take their live truth from the in-memory stream, while idle sessions are reconstructed from persisted history plus cached side-state. Shared workspace facts such as unread membership live in Workspace State below, not in the transcript snapshot. Start here when you need the holistic picture of where session state comes from and which layer is authoritative. Files: [`src/functions/sdk/historyReplay.ts`](src/functions/sdk/historyReplay.ts), [`src/functions/state/sessionRegistry.ts`](src/functions/state/sessionRegistry.ts), [`src/functions/state/snapshotCache.ts`](src/functions/state/snapshotCache.ts), [`src/functions/sessions.ts`](src/functions/sessions.ts), [`src/functions/runtime/stream/index.ts`](src/functions/runtime/stream/index.ts)

#### Workspace State

Workspace state owns shared in-memory session facts that are not session transcripts or durable session metadata: draft sessions, draft prompts, unread membership, hyper membership, and the running-session projection. The public server API is `src/functions/state/workspace/index.ts`; facet files under that folder are private storage details. Clients hydrate workspace state through React Query, then keep a Jotai workspace store current by applying accepted `WorkspaceEvent`s. `useWorkspace` owns the single workspace event sink, hydration, reconnect healing, optimistic `WorkspaceAction` dispatch, and open-session read clearing. `src/lib/session/queryCache.ts` only syncs durable session-list query data from `session.upserted` and `session.deleted`. Start here when you need to understand pre-session drafts, cross-device composer text, unread markers, or sessions hidden from the normal list. Files: [`src/functions/state/workspace/index.ts`](src/functions/state/workspace/index.ts), [`src/lib/workspace/state.ts`](src/lib/workspace/state.ts), [`src/hooks/workspace/useWorkspace.ts`](src/hooks/workspace/useWorkspace.ts), [`src/hooks/session/useDrafts.ts`](src/hooks/session/useDrafts.ts), [`src/hooks/session/useDraftPrompt.ts`](src/hooks/session/useDraftPrompt.ts), [`src/hooks/session/useHyperSessions.ts`](src/hooks/session/useHyperSessions.ts), [`src/lib/session/queryCache.ts`](src/lib/session/queryCache.ts)

### Automations

The automation scheduler decides when automations run and drives each scheduled run through its lifecycle. It exists so recurring work can be claimed, dispatched, tracked, and finalized consistently, including reuse of prior session IDs where appropriate. Start here when you need to understand how automation runs start and complete over time. Files: [`src/functions/automations/scheduler.ts`](src/functions/automations/scheduler.ts)

### Terminal

The terminal WebSocket service owns the lifecycle of interactive terminal sessions, including PTY creation, reconnect behavior, idle/orphan cleanup, and scrollback replay. It exists so terminal clients can disconnect and reconnect without losing the right view of terminal state. Start here when you need to understand terminal session ownership, replay behavior, or PTY lifecycle rules. Files: [`terminal-server/AGENTS.md`](terminal-server/AGENTS.md)

## Writing Great Code

- Core principles
  - Model the domain directly with intuitive, well-named primitives and abstractions that become the core nouns and verbs of the subsystem.
  - Add concise module-level comments when they help a reader understand the role the module plays in the system.
  - Keep shared helpers generic, and put caller-specific policy at the edges.
  - Extract helpers when they remove real repetition or clarify intent. Inline them when they only add indirection.
  - Organize files so they read top-to-bottom: domain types and policy first, then helpers, then public entrypoints when they mainly compose internal logic. In simpler modules, leading with the public API can be clearer.
- Module boundaries
  - Use normal imports by default. Use dynamic imports only when they solve a real module-cycle or runtime-boundary problem.
- For a model example of this style, see [`src/functions/sdk/projector.ts`](src/functions/sdk/projector.ts).

## Writing Great Tests

- Core principles
  - Test high-signal, user-visible behavior and lifecycle contracts, not private implementation details or duplicated logic.
  - Organize files from most common behavior to least common behavior so they read like a spec.
  - Use `describe(...)` to group a logical behavior area and `test(...)` for one specific behavior within it, even if proving it takes multiple assertions.
  - Use small setup and assertion helpers where they improve readability, but not when they hide the behavior under test.
  - Keep tests deterministic: introduce seams only where needed.
  - Avoid over-mocking; use small fakes that preserve protocol shape and failure modes.
- Bun specifics
  - Use `test(...)` + `describe(...)` from `bun:test`.
  - Use `mock.module(...)` and spies over threading test-only dependency bags through production APIs.
  - Keep test seams narrow: if production already has a natural shared entrypoint, test that instead of widening the API.
  - Use `onTestFinished(...)` for per-test cleanup instead of shared mutable teardown state.
  - For timer-driven behavior, use short real timers (`Bun.sleep(...)`) with explicit test timeouts; Bun does not fully mock timeout APIs yet.
- For a model example of this style, see [`src/functions/sdk/projector.test.ts`](src/functions/sdk/projector.test.ts).

## Post-Change Checklist

- Run `bun format` and fix any formatting issues.
- Run `bun lint` and fix any lint issues.
- Run `bun check` and fix any typecheck issues.
- Run `bun test` and fix any failing tests.
- For significant changes, dogfood the change with the `dogfood` skill.

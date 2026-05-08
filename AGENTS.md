HmmThis project is a full-stack web application built with Bun, TanStack Start/Router/Query, React, Tailwind, ShadCN, and the GitHub Copilot SDK.

## Architecture

Start with the subsystem that matches your change. These are the main layers that shape how Toy Box works end to end.

### Sessions

#### SDK -> Domain Projector

The projector translates raw SDK session events into the canonical session events the rest of the app understands. It keeps streaming behavior and history replay consistent for visible tool calls, hidden tool calls, synthetic events, and session metadata. Start here when you need to understand how SDK output becomes app state. Files: [`src/functions/sdk/projector.ts`](src/functions/sdk/projector.ts)

#### Session State Model

Session state in Toy Box combines three layers: persisted SDK-backed session history and metadata, live in-memory runtime state, and auxiliary cached per-session state such as worktrees and unread markers. The key rule is that active sessions take their live truth from the in-memory stream, while idle sessions are reconstructed from persisted history plus cached side-state. Start here when you need the holistic picture of where session state comes from and which layer is authoritative. Files: [`src/functions/sdk/sessionState.ts`](src/functions/sdk/sessionState.ts), [`src/functions/state/sessionCache.ts`](src/functions/state/sessionCache.ts), [`src/functions/sessions.ts`](src/functions/sessions.ts), [`src/functions/runtime/stream.ts`](src/functions/runtime/stream.ts)

#### Runtime Streams

The runtime stream layer owns the live server-side lifecycle of an active session. It supports multi-client behavior, mid-turn reconnect and reattachment, prompt queuing onto already-running sessions, and the current in-memory truth for active streams. Start here when you need to understand how active sessions behave while work is in flight. Files: [`src/functions/runtime/stream.ts`](src/functions/runtime/stream.ts)

#### Realtime Sync and Query Cache

This layer keeps the canonical React Query state for session lists, session details, and automation lists synchronized across clients. Query caches provide the local source of truth for list and detail views, while the server broadcasts updates over SSE and client cache helpers apply them for multi-client sync, unread markers, running indicators, and automation status. Start here when you need to understand how shared state propagates outside an active session stream. Files: [`src/functions/runtime/broadcast.ts`](src/functions/runtime/broadcast.ts), [`src/routes/api/events.ts`](src/routes/api/events.ts), [`src/hooks/events/useServerEvents.ts`](src/hooks/events/useServerEvents.ts), [`src/lib/session/sessionsCache.ts`](src/lib/session/sessionsCache.ts), [`src/hooks/automations/cache.ts`](src/hooks/automations/cache.ts), [`src/lib/queries.ts`](src/lib/queries.ts)

#### Session Reducer

The session reducer is the canonical client-side state machine for a session. It turns projected session events into the UI state for messages, streaming assistant output, queued prompts, todos, status transitions, and linked session behavior. Start here when you need to understand what a session event means to the UI. Files: [`src/lib/session/sessionReducer.ts`](src/lib/session/sessionReducer.ts)

### Automations

The automation scheduler decides when automations run and drives each scheduled run through its lifecycle. It exists so recurring work can be claimed, dispatched, tracked, and finalized consistently, including reuse of prior session IDs where appropriate. Start here when you need to understand how automation runs start and complete over time. Files: [`src/functions/automations/scheduler.ts`](src/functions/automations/scheduler.ts)

### Terminal

The terminal WebSocket service owns the lifecycle of interactive terminal sessions, including PTY creation, reconnect behavior, idle/orphan cleanup, and scrollback replay. It exists so terminal clients can disconnect and reconnect without losing the right view of terminal state. Start here when you need to understand terminal session ownership, replay behavior, or PTY lifecycle rules. Files: [`terminal-server/AGENTS.md`](terminal-server/AGENTS.md)

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

## Post-Change Checklist

- Run `bun format` and fix any formatting issues.
- Run `bun lint` and fix any lint issues.
- Run `bun check` and fix any typecheck issues.
- Run `bun test` and fix any failing tests.
- For significant changes, dogfood the change with the `dogfood` skill.

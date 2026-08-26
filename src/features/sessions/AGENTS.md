# Sessions

Sessions are Toy Box's foundational unit of conversation and agent work. This feature owns the
isomorphic session contract, browser access and streaming lifecycle, validated RPC ingress, and
the UI that presents and controls a session. Automations, Inbox, Workers, Hyper, and apps compose
ordinary sessions rather than introducing another transcript or execution model.

## Domain model

`model/` is the canonical application language for a session:

- `index.ts` owns transcript, queue, canvas, todo, snapshot, completion, metadata, and session-list
  values.
- `protocol.ts` owns RPC schemas and infers every TypeScript type that crosses those validated
  boundaries.
- `agentNotifications.ts` owns the validated side-channel vocabulary, labels, coalescing, and
  agent guidance.
- `fileDiffs.ts` parses edit and patch tool-call results for both SDK artifact projection and
  transcript presentation.
- `modelConfiguration.ts` owns the validated model, reasoning-effort, and context-tier
  configuration shared by sessions and their managed workflows.
- `reducer.ts` is the one pure transition function shared by live server execution, persisted
  history replay, and browser streaming.
- `constants.ts` contains stable persisted identity and path conventions.

`SessionsState` is the durable session-list read model: SDK metadata, worktrees, and worker
parentage fetched together so ordinary lists can hide workers while apps can still project child
sessions. Workers owns worker records and execution; Sessions only consumes that classification
when assembling its read model.

## Client access and lifecycle

`queries.ts` is the declarative read API for the durable session list, one transcript snapshot,
available models, and CWD-scoped skills. `mutations.ts` is the request/response operation API for
creation, drafts, delivery, queue control, abort, rewind, rename, deletion, and worktree actions. It
owns only the cache transitions that make those operations immediate and rolls optimistic changes
back when the request fails.

`queryCache.ts` applies shared workspace session events to session-owned queries. The workspace
event stream is a synchronization hint; the list query and session snapshot remain the recovery
sources. An idle conversation rewind refreshes the initiating client's snapshot and emits a
`session.touched` hint so other clients refresh its detail and list metadata; it never rewinds files.

`useSession.ts` owns one mounted session's browser lifecycle. It hydrates a cold snapshot,
subscribes while visible, reduces ordered events, batches text deltas to animation frames, and
exposes delivery and control operations. The long-lived async event stream deliberately remains
explicit instead of being disguised as a mutation. Ending a browser subscription never stops
server work; abort is a separate operation.

`useDrafts.ts` and `useDraftPrompt.ts` own draft creation, reuse, and synchronized composer text.
`useModels.ts` composes the model catalog with the workspace default. `useWarmSessionSnapshots.ts`
retains explicitly pinned snapshots without creating UI output or a second cache.

## Presentation

`components/` owns the complete session presentation: `SessionPane`, passive previews, overlays,
SDK canvases, the transcript, composer, location controls, and sidebar list. Components own their
mutation observers and browser-local interaction state. Reusable managed-session surfaces such as
Inbox may consume the composer or location controls directly.

The [workspace pane system](../../workspace/AGENTS.md) still owns pane identity,
placement, focus, host chrome, and Main/Hyper composition. It renders `SessionPane` as a leaf but
does not own session data or streaming behavior.

## Server kernel

`server/` is Toy Box's foundational session implementation:

- [`runtime/`](server/runtime/AGENTS.md) is the public server capability for creation, delivery,
  streaming, snapshots, completion, queue control, abort, idle conversation rewind, and deletion.
  `SessionStream` remains its live implementation detail.
- [`sdk/`](server/sdk/AGENTS.md) isolates Copilot client operations, raw-event projection, history
  replay, attachments, notifications, skills, and system instructions.
- [`state/`](server/state/AGENTS.md) owns SDK handles, session role resolution, snapshots, drafts,
  worktrees, and complete resource teardown.
- `tools.ts` defines the model-facing operations that belong to Sessions. The application-level
  catalog in `src/server/sessionTools.ts` combines these with tool contributions from other
  features and workspace settings.
- `functions.ts` is the validated browser ingress, including the short-lived voice token endpoint.
  It delegates to the same server capabilities used by trusted orchestration.

Automations, Inbox, and Workers build on `@sessions/server/runtime`. They add scheduling,
ownership, admission, and retention policy without importing Copilot details, snapshot storage, or
the registry implementation. Shared workspace projection and process infrastructure remain outside
the feature because they compose multiple domains rather than define session execution.

## Invariants

- One `SessionEvent` model and one reducer must produce the same transcript live, after reconnect,
  and from persisted history.
- Active truth comes from the live runtime; idle truth comes from SDK history. Query snapshots are
  caches, not another authority.
- Queries and mutations are the browser API for request/response session operations; `useSession`
  owns the connected stream lifecycle.
- Managed features may govern a session's lifecycle, but they do not redefine session execution,
  transcript state, SDK projection, registry, or UI primitives.
- Generic workspace composition may render and arrange a session, but it must not copy session
  state into layout state.

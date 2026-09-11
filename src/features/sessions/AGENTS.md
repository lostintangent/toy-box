# Sessions

Sessions are Toy Box's foundational unit of conversation and agent work. This feature owns the
isomorphic session contract, browser access and streaming lifecycle, validated RPC ingress, and
the UI that presents and controls a session. Automations, Inbox, Workers, Hyper, Agents, Channels,
and apps compose sessions rather than introducing another transcript or execution model.

## Domain model

`model/` is the canonical application language for a session:

- `index.ts` owns transcript, queue, canvas, todo, snapshot, completion, metadata, and session-list
  values.
- `protocol.ts` owns RPC schemas and infers every TypeScript type that crosses those validated
  boundaries.
- `systemMessages.ts` owns the validated system-message vocabulary, labels, coalescing, and
  model-facing prompts.
- `fileDiffs.ts` parses edit and patch tool-call results for both SDK artifact projection and
  transcript presentation.
- `modelConfiguration.ts` owns the validated model, reasoning-effort, and context-tier
  configuration shared by sessions and their managed workflows.
- `reducer.ts` is the one pure transition function shared by live server execution, persisted
  history replay, and browser streaming.
- `constants.ts` contains stable persisted identity and path conventions.

`SessionsState` is the durable session-list read model. It combines SDK metadata and worktrees with
feature-owned classification needed to hide managed sessions and nest Worker children. A managed
Session remains in this projection only when its owner deliberately exposes the backing Session as
an addressable workspace resource; Automation, Inbox, Hyper, and retained Worker surfaces do.
Private Agent Sessions are passive-only, so the application composition layer omits them from both
snapshot and live projections. Every new Session role must explicitly choose this policy.

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

Operational Agent mentions are metadata on ordinary user messages. Mention completion can create a
new named Agent whose first Session or Channel turn establishes its persona and avatar. Ingress
resolves text to stable Agent IDs before queuing, so later Agent renames do not redirect an accepted request. `SessionStream` exposes one
message-start hook after the SDK accepts a turn, so Agents never runs for a merely queued message that
can still be edited or canceled. Session and Channel composers reuse Agent-owned mention controls;
the session transcript still owns user and system message placement. For a
mention-directed request, the host agent defers to the attributed Agent response instead of answering
on its behalf or echoing its completion; it contributes only when the user also requested synthesis or
distinct host work.

`useDrafts.ts` and `useDraftPrompt.ts` own draft creation, reuse, and synchronized composer text.
`useModels.ts` composes the model catalog with the workspace default. `useWarmSessionSnapshots.ts`
retains explicitly pinned snapshots without creating UI output or a second cache.

## Presentation

`components/` owns the complete session presentation: `SessionPane`, passive previews, overlays,
SDK canvases, the transcript, composer, location controls, and sidebar list. Components own their
mutation observers and browser-local interaction state. Reusable managed-session surfaces such as
Inbox may consume the composer or location controls directly. Assistant Markdown keeps Streamdown's
HTML and protocol sanitization but omits URL hardening so relative links remain semantic anchors;
links that resolve to an already-published session artifact focus that artifact's editor pane.

The [workspace pane system](../../workspace/AGENTS.md) still owns pane identity,
placement, focus, host chrome, and Main/Hyper composition. It renders `SessionPane` as a leaf but
does not own session data or streaming behavior.

## Server kernel

`server/` is Toy Box's foundational session implementation:

- [`runtime/`](server/runtime/AGENTS.md) is the public server capability for creation, delivery,
  streaming, snapshots, completion, queue control, abort, idle conversation rewind, and deletion.
  `SessionStream` remains its live implementation detail.
- [`sdk/`](server/sdk/AGENTS.md) isolates Copilot client operations, raw-event projection, history
  replay, attachments, system messages, skills, and universal system prompts.
- [`state/`](server/state/AGENTS.md) owns SDK handles, snapshots, drafts, worktrees, and complete
  resource teardown.
- `tools.ts` defines the model-facing operations that belong to Sessions. Application-level modules
  in `src/server/sessionTools.ts`, `src/server/sessionHooks.ts`, and
  `src/server/managedSessions.ts` compose feature-owned SDK configuration, message-start reactions,
  role and presentation policy, and owned-resource teardown over narrow Session extension points.
- `functions.ts` is the validated browser ingress, including the short-lived voice token endpoint.
  It delegates to the same server capabilities used by trusted orchestration.

Automations, Inbox, Workers, and Agents build on `@sessions/server/runtime`. They add scheduling,
ownership, identity, membership, admission, and retention policy without importing Copilot details,
snapshot storage, or the registry implementation. Channels builds on Agent membership rather than
defining another execution path. Shared workspace projection and process infrastructure
remain outside the feature because they compose multiple domains rather than define session execution.

## Invariants

- One `SessionEvent` model and one reducer must produce the same transcript live, after reconnect,
  and from persisted history.
- Active truth comes from the live runtime; idle truth comes from SDK history. Query snapshots are
  caches, not another authority.
- Queries and mutations are the browser API for request/response session operations; `useSession`
  owns the connected stream lifecycle.
- Managed features may govern a session's lifecycle, but they do not redefine session execution,
  transcript state, SDK projection, registry, or UI primitives.
- The application rebuilds Agent configuration for comparison between executions. Single-flight
  runtime acquisition replaces the idle SDK handle only when that effective configuration changed;
  active delivery keeps its existing handle. Callers do not coordinate configuration refresh. This
  preserves durable history, workspace identity, and worktree state.
- Generic workspace composition may render and arrange a session, but it must not copy session
  state into layout state.

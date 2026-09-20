# Sessions

Sessions are Toy Box's foundational unit of conversation and agent work. This feature owns the
isomorphic session contract, browser access and streaming lifecycle, validated RPC ingress, and
the UI that presents and controls a session. Automations, Inbox, Workers, Hyper, Channels,
and apps compose sessions rather than introducing another transcript or execution model.

## Domain model

`model/` is the canonical application language for a session:

- `index.ts` owns `Session` (identity, optional provider, context, title, and timestamps) and
  `SessionState` (reduced transcript, activity, queue, artifacts, and todos). A draft session
  has no provider; `provider.sessionId` overrides the root ID only when native history uses a
  different ID. `SessionContext` groups directory and Git metadata. Snapshots cache `SessionState`
  and are keyed by session ID outside the value.
- `protocol.ts` owns RPC schemas and infers every TypeScript type that crosses those validated
  boundaries.
- `systemMessages.ts` owns the validated system-message vocabulary, labels, coalescing,
  model-facing prompts, and the structured display codec retained in native provider history.
- `questions.ts` owns derived queries over pending and blocking transcript questions.
- `fileDiffs.ts` parses edit and patch tool-call results for transcript presentation and
  identifying artifact-only tools that stay hidden.
- [Providers' model](../providers/model/index.ts) supplies the validated model, reasoning-effort,
  and context-tier configuration used by session state and message ingress.
- `reducer.ts` is the one pure transition function shared by live server execution, persisted
  history replay, and browser streaming. Its status records provider activity; the workspace
  projects the user-facing waiting state from pending blocking questions.
- `constants.ts` contains stable persisted identity and path conventions.

`Message` is one canonical transcript entry. `SessionMessage` is an identified user or system
submission addressed to a session, including its turn-specific model or immediate-send policy.
A queued message is that same value plus its queue status. `SessionLaunch` composes the initial
message payload with an optional `SessionLocation`; location is creation context, not message data.

`SessionsState` is the session catalog read model. It combines draft records, provider metadata, and worktrees
with Worker ownership needed to hide managed sessions from ordinary roots while retaining linked
children, previews, and activity. Automation, Inbox, and Hyper remain ordinary addressable entries.
Every new Session role must explicitly choose its projection policy.

`Session.context` carries its execution `directory` and available native catalog Git fields.
Session IDs, including automation IDs, are plain UUIDs. Imported histories use `provider:nativeId`, which
the sidebar uses to distinguish external sessions without inspecting provider-native namespaces.
Sidebar badges, pane pickers, and derived recent directories use those fields for immediate
presentation, including SSR. Available catalog Git metadata takes precedence; the directory-keyed
`sessionQueries.context` cache only resolves missing information and newly selected paths.
Unselected MRU entries do not start lookups. Creation and parent inheritance carry only the
directory and worktree choice; worktrees retain their own state.

## Client access and lifecycle

`queries.ts` is the declarative read API for the durable session list, one transcript snapshot,
and CWD-scoped skills. `mutations.ts` is the request/response operation API for
creation, first-turn launch, delivery, queue control, abort, rewind, rename, deletion, and worktree actions. It
owns only the cache transitions that make those operations immediate and rolls optimistic changes
back when the request fails.

`queryCache.ts` applies shared workspace session events to session-owned queries. The workspace
event stream is a synchronization hint; the list query and session snapshot remain the recovery
sources. An idle conversation rewind refreshes the initiating client's snapshot and emits a
`session.touched` hint so other clients refresh its detail and list metadata; it never rewinds files.
A deletion cancels pending history reads and clears any cached transcript, so an Automation can
reuse its public ID without appending its next execution to the previous run in an open pane.

`useSession.ts` owns one mounted session's browser lifecycle. It reads snapshots and subscribes
while visible, reduces ordered events, batches text deltas to animation frames, and
exposes delivery and control operations. The long-lived async event stream deliberately remains
explicit instead of being disguised as a mutation. Ending a browser subscription never stops
server work; abort is a separate operation.

Ordinary Sessions remain unbranded coordinators. Their Channel tools can create Channels and
channel-specific Agents, discover available model configurations, read Channel context and rosters,
post user-attributed messages, share artifacts, and wait for Channel Agent work. Agent identity and
`@mention` delivery belong to Channels.

`useSessions.ts` owns the catalog and optimistic creation, including reuse of an untouched
draft session. `useDraftPrompt.ts` synchronizes unsent composer text. First submission in
`useSession.ts` adds the provider and context to the existing catalog entry and transitions the
same ID to running, so its timestamp and directory appear before provider creation completes.
Creation failure reconciles catalog and workspace state from the server.
Providers' `useModels.ts` composes the model catalog with the workspace default. `useWarmSessionSnapshots.ts`
retains explicitly pinned snapshots without creating UI output or a second cache.

## Presentation

`components/` owns the complete session presentation: `SessionPane`, passive previews, overlays,
SDK canvases, the transcript, composer, location controls, and sidebar list. Components own their
mutation observers and browser-local interaction state. Reusable managed-session surfaces such as
Inbox may consume the composer or location controls directly. Assistant Markdown keeps Streamdown's
HTML and protocol sanitization but omits URL hardening so relative links remain semantic anchors;
links that resolve to an already-published session artifact focus that artifact's editor pane.
Assistant messages can carry an optional error alongside their text and tools. A failed
terminal event preserves existing output and attaches its error for a transcript warning
card; a missing provider message uses the generic error notice.
Native assistant-message IDs distinguish streamed updates from new messages and survive
snapshot seeding. Text and reasoning deltas append verbatim; complete messages replace their
matching previews, and complete reasoning replaces the current reasoning text. Providers normalize
native blocks into these explicit meanings; the reducer never guesses from overlapping text.

The [workspace pane system](../../workspace/AGENTS.md) still owns pane identity,
placement, focus, host chrome, and Main/Hyper composition. It renders `SessionPane` as a leaf but
does not own session data or streaming behavior.

## Server kernel

`server/` is Toy Box's foundational session implementation:

- [`runtime/`](server/runtime/AGENTS.md) is the public server capability for creation, delivery,
  streaming, snapshots, completion, queue control, abort, idle conversation rewind, and deletion.
  `SessionStream` remains its live implementation detail.
- `providers.ts` prepares provider configuration, dispatches native operations, and binds public/native
  identities. [Providers](../providers/AGENTS.md) defines the native contract, registers implementations,
  and aggregates catalogs; Sessions owns the shared domain events and uses Providers' model configuration.
- `instructions.ts`, `bundledSkills.ts`, and `artifacts.ts` own shared instructions, role-scoped
  skills, and provider-independent files. Provider implementations receive prepared directories and
  question policy rather than deriving them from session roles or storage conventions.
- Files' `server/watcher.ts` owns the shared artifact watcher used by discovery and open editors.
  It batches notifications by session ID; the runtime refreshes only affected active sessions.
  Artifact membership comes from the filesystem; idle snapshots read the current directory.
- [`state/`](server/state/AGENTS.md) owns cached provider connections, snapshots, session records, worktrees, and complete
  resource teardown.
- `tools.ts` defines the model-facing operations that belong to Sessions. Application-level modules
  in `src/server/sessionConfiguration.ts` and `src/server/managedSessions.ts` compose feature-owned Session
  configuration, role and presentation policy, and owned-resource teardown over narrow Session
  extension points.
- `functions.ts` is the validated browser ingress, including the short-lived voice token endpoint.
  It delegates to the same server capabilities used by trusted orchestration.

Automations, Inbox, and Workers build on `@sessions/server/runtime`. They add scheduling, ownership,
admission, and retention policy without importing provider details, snapshot storage, or the registry
implementation. Channel Agents are durable Channel-owned Workers whose configuration carries their
local identity and collaboration tools. Shared workspace projection and process
infrastructure remain outside the feature because they compose multiple domains rather than define
Session execution.

## Invariants

- One `SessionEvent` model and one reducer must produce the same transcript live, after reconnect,
  and from persisted history.
- Provider-native children are `agent` tool calls: providers keep native IDs private, route child
  activity with `parentToolCallId`, and the reducer stores that activity in `ToolCall.subagent`.
- Active truth comes from the live runtime; idle truth comes from provider history. Query snapshots
  are cached `SessionState` values, not another authority or another state shape.
- Queries and mutations are the browser API for request/response session operations; `useSession`
  owns the connected stream lifecycle.
- Managed features may govern a session's lifecycle, but they do not redefine session execution,
  transcript state, native event projection, registry, or UI primitives.
- The application rebuilds private Channel Agent configuration for comparison between executions.
  Single-flight runtime acquisition replaces the idle provider connection only when that effective
  configuration changed; active delivery keeps its existing session. Callers do not coordinate
  configuration refresh. This preserves durable history, workspace identity, and worktree state.
- Generic workspace composition may render and arrange a session, but it must not copy session
  state into layout state.

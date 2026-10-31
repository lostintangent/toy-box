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
- `references.ts` owns the `session` and `file` prompt references carried in message text:
  their construction from a session or search path, and `isPromptReference`, which recognizes
  those kinds among the shared codec's references.
- `systemMessages.ts` owns the validated system-message vocabulary, labels, coalescing,
  model-facing prompts, and the structured display codec retained in native provider history.
- `questions.ts` owns derived queries over pending and blocking transcript questions.
- `fileDiffs.ts` parses edit and patch tool-call results for transcript presentation and
  identifying artifact-only tools that stay hidden. Its `DiffStats` value comes from
  `shared/diffStats.ts`, also used by Channel task outcomes.
- [Providers' model](../providers/model/index.ts) supplies the validated model, reasoning-effort,
  and context-tier configuration used by session state and message ingress.
- `reducer.ts` is the one pure transition function shared by live server execution, persisted
  history replay, and browser streaming. Its status records provider activity; the runtime
  projects the user-facing waiting activity from pending blocking questions.
- `SessionState.preview` is the optional current runnable result: a URL or
  Screen ID, using `shared/preview.ts` like Channels. Successful
  `set_session_preview` results project to `preview_changed`.
  Replacing or clearing the reference never stops the underlying application.
  Screens owns host-addressed capture/control state independently of sessions;
  only the reference is replayed. Agents list and present screens for people;
  app automation uses provider computer-use tools or playwright-cli.
- `ToolCall.output` previews a running tool. `tool_output_delta` appends to it, the reducer keeps
  its most recent 8 KiB, and the result replaces it, so a live call converges with the same call
  rebuilt from history. Output after the result, such as a background shell's, is dropped.
- `SessionState.contextUsage` is the provider-reported context occupancy behind the composer's
  meter, which appears once the window is half full. Native histories omit it, so snapshot
  rebuilds keep the last reported value while the server runs; a rewind's refresh clears it.
- `constants.ts` contains stable persisted identity and path conventions.

`Message` is one canonical transcript entry. `SessionMessage` is an identified user or system
submission addressed to a session, including its turn-specific model or immediate-send policy.
A queued message is that same value plus its queue status. `SessionLaunch` composes the initial
message payload with an optional `SessionLocation`; location is creation context, not message data.

`SessionsState` combines draft records, provider metadata, worktrees, and a typed `ownership` index
for Automation and Worker sessions. Ownership is derived from feature records and can exist
before a backing session. Worker ownership includes its optional parent relationship. Generic
consumers use this index for filtering, draft reuse, editor defaults, and SDK classification rather
than consulting feature catalogs. Hyper membership remains process-local Workspace coordination.
Managed sessions remain addressable for linked children, previews, and activity.

`model/activity.ts` owns session activity: whether a session is running, waiting on a blocking
question, working in the background, or finished with unread results. Its pure reducer is shared
by the server store and every browser, and a session without an entry is idle. Live activity
carries `since`, stamped from the `at` of the event that began the run; waiting and background keep
it and a new run restarts it. Background sessions remain live but do not count as foreground work.
The runtime writes activity through `server/state/activity.ts`, which broadcasts each accepted
transition as a `session.*` workspace event. Browsers read it through `sessionQueries.activity()`
and `useSessionActivity.ts`, and `sessionMutations.markRead` clears unread before the server confirms.

`src/server/managedSessions.ts` at the application composition boundary selects the 250 most recent
ordinary, unpinned sessions, plus all managed and pinned sessions. Drafts and sessions with shared
activity are retained as well. This bounds browsing metadata without deleting history; old ordinary
sessions outside the catalog do not reopen through a URL. The sidebar filters the retained catalog
before displaying up to 50 ordinary matches, while keeping pins visible outside that display limit.
Sessions with Worker children have a compact child-count badge and chevron beside the title.
The badge is a separate disclosure button, collapsed by default.
It occupies only the title line; the relative time and location keep their normal alignment.
Expanding it reveals nested sidebar rows, newest first within each parent, with deeper
descendants independently expandable. Clicking the session title still opens the session.
Expansion is local to the mounted row; collapsed descendants are neither built nor mounted.
Children follow their parent's visibility
without consuming the ordinary-session limit or forming separate pinned or time groups.
The sidebar and app SDK share the catalog's child-session selector; no Worker query or
additional ownership state is needed. Provider-native subagents remain transcript tool calls,
not independently addressable sidebar rows.
Spawning a Worker renders an ordinary tool call in the transcript and never publishes a linked
pane, including when replaying older spawn results.
An explicit `open_session` call still publishes the child through the ordinary session pane path.

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
and directory-, role-, and provider-scoped skills. `mutations.ts` is the request/response operation API for
creation, first-turn launch, delivery, queue control, abort, rewind, rename, deletion, and worktree actions. It
owns only the cache transitions that make those operations immediate and rolls optimistic changes
back when the request fails.

`cache.ts` applies shared workspace session events to session-owned queries. The workspace
event stream is a synchronization hint; the list query and session snapshot remain the recovery
sources. Its `recreateSessionInCache` operation cancels older reads and replaces the catalog entry
and transcript with a fresh draft containing the first message. Callers pass that message's
`clientId` to their server operation and call `invalidateSessionQueries` when it settles, so
success, overlap, and failure reconcile from authoritative state. This cache operation has no
React lifetime and is shared by mutation owners such as Automations.

Automation events also maintain their ownership claims, while session creation carries
Worker ownership, including Inbox-owned work. Backing-session deletion preserves Automation
ownership until the owning record is deleted; Worker ownership ends with its session. Inbox result
events do not touch Sessions queries. Committed ownership changes replace an
overlapping catalog fetch with a post-commit read. SSR initializes the complete catalog before the
shared subscription mounts, and reconnects recover ownership from the authoritative catalog.

An idle conversation rewind refreshes the initiating client's snapshot and emits a
`session.touched` hint so other clients refresh its detail and list metadata; it never rewinds files.
Deletion cancels pending history reads and clears the cached transcript. A replacement upsert
with a different `createdAt` does the same for an existing provider session and starts fresh
catalog metadata. Acknowledging an optimistic draft retains its starting message, which the
canonical echo replaces by `clientId`. The browser adopts the replacement snapshot while it
is a draft, before subscribing to its first turn.
The public ID and mounted workspace pane remain stable.

`useSession.ts` owns one mounted session's browser lifecycle. It reads snapshots and subscribes
while visible, reduces ordered events, batches text and tool output deltas to animation frames, and
exposes delivery and control operations. The long-lived async event stream deliberately remains
explicit instead of being disguised as a mutation. Ending a browser subscription never stops
server work; abort is a separate operation.

Ordinary Sessions remain unbranded coordinators. Their Channel tools can create Channels with an
intrinsic lead, create channel-specific members, discover available model configurations, read
Channel context and rosters, post user-attributed messages, share artifacts, and wait for lead or
member work. Collaboration identity and `@mention` delivery belong to Channels.

`useSessions.ts` owns the catalog and optimistic creation, including reuse of an untouched
draft session. Unsent composer text is a Workspace saved draft keyed `session:<id>`. First submission in
`useSession.ts` adds the provider and context to the existing catalog entry and transitions the
same ID to running, so its timestamp and directory appear before provider creation completes.
Creation failure reconciles the catalog and session activity from the server.
Providers' `useModels.ts` composes the model catalog with the workspace default. `useWarmSessionSnapshots.ts`
retains explicitly pinned snapshots without creating UI output or a second cache.

## Presentation

`components/` owns the complete session presentation: `SessionPane`, passive previews, overlays,
SDK canvases, the transcript, composer, location controls, and sidebar list. Components own their
mutation observers and browser-local interaction state. Reusable managed-session surfaces such as
Inbox may consume the composer or location controls directly.

Active session panes offer a pane-local transcript view, initialized when the pane opens from
the workspace's `defaultSessionView` setting (All messages by default). Responses
shows user and assistant text without system messages, ordinary tool calls, or reasoning.
Question cards and their recorded answers remain conversation, and assistant errors
and the activity indicator stay visible. `components/transcript/transcriptView.ts` derives the
visible messages without changing session state; filtering precedes transcript windowing.
Switching views lands the transcript afresh without restarting the session or its subscription.
The pane's override is neither persisted nor synchronized across clients. Changing the workspace
default does not change already-open panes; overlays and passive previews keep the full view.

The composer stacks what a session produced (artifacts newest first, plus todo progress and changed
files) and what is waiting (queued messages) above the message being written. Sessions and Channels
share [`ComposerTray`](components/outputs/ComposerTray.tsx). [`components/outputs/`](components/outputs/)
holds that output presentation: artifact pills, the checklist popup, and page and screen previews.
`PagePreview` is the sandboxed thumbnail that HTML artifacts and a Channel's preview share. They
combine Files identity and previews with the current surface's pane focus and file-worker activity,
while callers supply their artifacts, checklist, and additional controls.
An active Session pane publishes only one selected artifact editor. Its initial choice is the
session's designated artifact, or otherwise the most recently updated file. That choice stays put
as other artifacts arrive or change; tray and transcript clicks replace it. If the selected file
disappears, the same initial-choice policy supplies a replacement. The full artifact catalog remains
available without mounting its other editors, and explicit file opens remain independent.
Queued user messages can be sent now, removed, or edited:
editing takes a message out of the queue and back into the draft, as does stopping the turn, so
queued input never disappears. Draft text is a Workspace saved draft, so it follows the
session across clients. `/` completes skills at the start of a prompt and `#` inserts working-directory file
references. `@` filters the existing session catalog by title, newest first, with relative
update times. It reuses the sidebar's `selectTopLevelSessions` selector, then excludes the current
session and providerless drafts. Workers, automations, and Hyper are excluded. It does not scan
older provider history or read transcripts while picking.
File completions retain the previous rows during search, disabling selection until the query
catches up. Skills are described by their purpose on a second line, and files show their folder
beside their name; session choices show the title and relative update time, without provider/ID
subtitles.
Empty session, file, and skill results share italic no-match text.

Sessions and Channels share one composer shell in `shared/composers/`. A `ComposerDraft`, from
`useComposerDraft`, is the message being written: host-owned text plus images, sent together to
its `onSend`, or another destination the host picks, and then cleared. Hosts edit it only
through its verbs: `setValue` replaces the text, `append` puts messages back after the text and
images, and `submit` sends. A send whose promise rejects appends its message back, unless another
draft has been started since. It refuses to send while composing, while images are still being
read, or when empty, and it autofocuses on desktop. `<Composer draft>` edits that draft: it owns
image paste and drop, and the Enter, Shift+Enter, and empty-draft Backspace conventions after an
open menu's keys and the host's own; each handler in that chain defers by `defaultPrevented`.
Hosts configure it in its own terms through explicit props, since its layout is fixed: a `label`
and `placeholder`, a `tray` as the input's top band (inside its border and focus ring),
`completions` (sources plus the menu that renders their items), the `references` it shows as
pills, toolbar `controls`, and `actions`. The composer
matches, navigates, and inserts completions; hosts own their draft text and send targets. Every
host's text is a Workspace saved draft, spread into `useComposerDraft` from `useSavedDraft`.
`SessionComposer` reads `session:<id>`, or `inbox` when it composes new Inbox work, so neither
host passes it a prompt. Its draft runs Inbox work or delivers to the session by default;
delivery menus and Cmd+Enter send it elsewhere. `DeliveryControls.tsx` owns those choices:
Inbox's Run and Send, and a running session's Queue and Send now, whose `sendNowHotkey` the
placeholder and key handling share. Toolbar icon buttons are `ComposerAction`s, named by their
tooltips; `ComposerSendButton` is the one bound to the draft.

The shell's input is `shared/composers/input/ComposerInput`: a native editable surface
whose references render as atomic pills while its public value remains a string. Typing,
reference insertion, paste, and cut use native undo. Voice writes, queue restoration, and
Channel reply/mention actions replace or append through the draft's verbs;
these replacements start a new editing history, as does clearing the draft on submission.
Composition publishes typed text but defers an incoming replacement until composition ends;
the pending replacement takes precedence over provisional input. Plain-text paste and
canonical-source copy preserve reference identity without accepting HTML. `dom.ts` owns
browser editing mechanics; the input owns composition, focus, and value adoption, and reports
its selection, the caret's editable text run, to completions. Its handle exposes only focus and
composition state.
`beforeinput` is the single plain-text guard against formatting commands. `beforeinput` owns
pill deletion, from a key or not: a deletion that would separate a pill from its caret stop removes
both as one undoable edit. A final break after a deleted pill is removed unless it ends a newline.
The input grows through three rows before scrolling; measured overflow exposes session
expansion even for a single wrapping paragraph. Hosts can override sizing; expansion and
toolbar typing feedback remain separate presentation controls.

[`shared/references.ts`](../../shared/references.ts) owns the host-independent
`Reference { kind, target, label }` primitive, its `[label](kind:target)` codec, and
`splitReferences`, which divides text into literal runs and the references a host accepts. It is
foundational to messages as well as the composer: the input builds its pills from that split,
given a host's `ComposerReferences` presentation, and queue summaries render and label from it.
Kinds are URI-scheme identifiers defined by hosts, not a shared catalog. An unlabeled reference
decodes with its target as its label. Sessions recognizes `session` and `file`, encoded as
`[Title](session:PUBLIC_ID)` and `[Name](file:PATH)`.
Completion triggers are not part of the encoding. Other kinds remain ordinary text or Markdown
in Sessions; Channels' `@handle` mentions retain their own addressing semantics.
The composer does not parse Markdown.
The target escapes only what a Markdown link destination cannot carry (`%`, whitespace,
parentheses, and backslash), so agents read ordinary paths and IDs; earlier fully encoded
sources still decode. The label is a snapshot, never a lookup key. File targets
retain the path returned by directory search; a relative path resolves in the receiving
session's working directory, including a new worktree, rather than identifying one physical
file across all sessions. Their labels use the basename. Drafts, queues,
provider history, and copied messages retain that self-contained source.
[`components/references/`](components/references/) groups the shared reference presentation,
styles, and tests for the composer, queue summaries, and sent user messages; queue text stays literal,
while sent messages retain their existing Markdown sanitization.
One `promptReferenceKinds` table gives each kind its title and icon. The icon is the
stylesheet's mask, so pills and completion menu items show the same one, and one class helper
distinguishes draft pills from message pills.
File and session pills share a 10rem ellipsis cap with their own icons; the tooltip and
accessible label retain the full file path or session title and public ID.
Their feature-owned stylesheet supplies pill layout; the shared input owns only atomic
selection and caret behavior.
Both use the configured accent color; queued and sent message pills add a thin accent border
and a slightly stronger tint.
The session-history instructions direct the agent to `read_session` using the public ID.
Only encoded references are recognized. Pills are constructed on insertion, paste, and
draft adoption; ordinary typing stays native rather than being re-parsed after each key.
The composer does not infer references from bare names/paths or apply Markdown rules.
`completions/completionSources.ts` is a pure `promptCompletionSources` over the prompt's scope
and Hyper membership, which `SessionComposer` reads and passes in. Each source declares its id,
trigger, and no-match text, and projects an existing catalog query (`skillQueries`, the session
catalog, or `fileQueries.search`) into menu items with `select`, so a catalog is observed only
while its menu is open. The composer passes its session ID, directory, and model provider
explicitly, including from Inbox before a session exists.
Shared `useCompletions(sources)` follows the selection reported by the input and owns matching,
Query observation, per-source previous-item retention, acceptance guards, and the input, menu,
and item props. A trigger is a token pattern: a one-character trigger, then the query as its
first capture; `wordTrigger` builds the common start-or-after-whitespace form. Accepting an item
inserts its value, or the text its source's `accept` returns; a promise defers insertion, holds
off other acceptances, and surfaces a rejection as the menu's error. A `CompletionItem` has a
value, a label, an optional detail shown muted beside the label (where it is), an optional
description shown as a second line (what it is or does), and an optional group. The shared
`CompletionMenu` owns the menu chrome, group headings, each item's text,
searching and no-match text, errors, and editing: a host's `edit` returns how to edit what an item
names, and the menu renders one "Edit" button that keeps focus and never accepts its item. Hosts
supply only an item's icon, trailing metadata, and edit handler. The Session menu supplies icons,
the Global badge, and update times, and edits a skill by opening its file, without dispatching on
its source. Query
errors use the existing error boundary, not per-source error messages. Draft writes remain
host-owned.
Pointer-down preserves the insertion target; a completed click/tap accepts an item.
Touch scroll/cancel does not select, and leaving the menu invalidates the preserved target.
Focus that a menu gesture moved into the menu ends the completion when it leaves, since the
input has already blurred.

`SessionUserMessage` adds session rewind to the feature-independent
[`UserMessage`](../../shared/messages/UserMessage.tsx), whose actions separate themselves from
the shared [`CopyControl`](../../shared/messages/CopyControl.tsx) only when they render.

Assistant Markdown keeps Streamdown's
HTML and protocol sanitization but omits URL hardening so relative links remain semantic anchors;
links that resolve to an already-published session artifact focus that artifact's editor pane.
Assistant messages can carry an optional error alongside their text and tools. A failed
terminal event preserves existing output and attaches its error for a transcript warning
card; a missing provider message uses the generic error notice.
Native assistant-message IDs distinguish streamed updates from new messages and survive
snapshot seeding. Text and reasoning deltas append verbatim; complete messages replace their
matching previews, and complete reasoning replaces the current reasoning text. Providers normalize
native blocks into these explicit meanings; the reducer never guesses from overlapping text.

The [workspace pane system](../workspace/AGENTS.md) still owns pane identity,
placement, focus, host chrome, and Main/Hyper composition. It renders `SessionPane` as a leaf but
does not own session data or streaming behavior.

## Server kernel

`server/` is Toy Box's foundational session implementation:

- [`runtime/`](server/runtime/AGENTS.md) is the public server capability for creation, recreation, delivery,
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
  Artifact membership and modification times come from the filesystem; idle snapshots read the
  current directory.
- [`state/`](server/state/AGENTS.md) owns cached provider connections, snapshots, session records, worktrees, and complete
  resource teardown.
- `tools.ts` defines the model-facing operations that belong to Sessions. Application-level modules
  in `src/server/sessionConfiguration.ts` and `src/server/managedSessions.ts` compose feature-owned Session
  configuration, role and presentation policy, and owned-resource teardown over narrow Session
  extension points.
- `functions.ts` is the validated browser ingress, including the short-lived voice token endpoint.
  It delegates to the same server capabilities used by trusted orchestration.

Automations and Workers build on `@sessions/server/runtime`; Inbox builds on Workers. They add scheduling, ownership,
admission, and retention policy without importing provider details, snapshot storage, or the registry
implementation. Channel leads and members are durable Channel-owned Workers whose configuration
carries their local identity and collaboration tools. Shared workspace projection and process
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
- The application rebuilds private Channel agent configuration, including its working directory,
  for comparison between executions. Single-flight runtime acquisition replaces the idle provider
  connection only when that effective configuration changed; active delivery keeps its existing
  session. Callers do not coordinate configuration refresh. This preserves durable history,
  workspace identity, and worktree state.
- Generic workspace composition may render and arrange a session, but it must not copy session
  state into layout state.

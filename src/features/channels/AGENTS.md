# Channels

A Channel is a standing team of agents that works toward a purpose on the user's behalf. The user
says what they want. The Channel's lead frames the work, keeps a public task list, and brings in
specialist members only when their work becomes actionable. The team coordinates in one shared
transcript, much like a team chat: agents mention one another to hand off work, react to
acknowledge it, post statuses while they work, and share artifacts and a runnable preview as the
result takes shape. The team lives on the server, so work continues after the browser closes, and
the sidebar draws the user back only when it matters: an unread update, a question the lead
flagged, or a task list it completed.

A Channel is not a filtered Session or several Sessions side by side. Its defining split is private
thinking versus public collaboration. The lead and every member are durable Channel-owned Workers
with private Sessions where they reason and use tools, and none of that private work enters the
Channel. The Channel transcript is the complete public coordination surface, so everything the team
shares, and everything the user sees, was deliberately published. The user is the team's
stakeholder rather than part of it: an unmentioned user message reaches the lead, and the lead stays
accountable for the purpose and for the quality of every member's outcome.

## How a Channel unfolds

1. **Create.** The Channel and its lead commit together, and the lead starts immediately. With a
   purpose, it frames the work and posts a kickoff. Without one, it asks the user what to work on.
2. **Staff.** As work becomes actionable, the lead creates members with focused roles. Each one
   onboards by reading the Channel and establishing its role and avatar.
3. **Coordinate.** One audience policy routes every message, and mentions wake exactly the agents
   they name. A woken agent runs one private turn: it reads the Channel, acts publicly, and
   finishes, optionally leaving a waiting status.
4. **Involve the user.** The lead sends a question flagged as a request, or posts a result and
   completes the task list. The sidebar holds each until the user replies or reads it.
5. **Keep going.** Follow-ups privately wake waiting agents and routines wake the lead on a schedule,
   so ongoing work advances without anyone posting.

## Domain model

```text
Channel        name, purpose, directory, lead model, tasks, preview, user read position
├─ Team        the Channel's agents
│  ├─ Lead     intrinsic and fixed; its Worker and Session ID is the Channel ID
│  └─ Members  created on demand; editable and removable
├─ Transcript  sequenced user, agent, and system messages, plus agent reactions
├─ Artifacts   shared workspace files
└─ Routines    scheduled prompts that privately wake the lead
```

- `Channel` owns its name, optional purpose and working directory, lead model, public
  tasks, optional URL-or-screen preview, human read position, latest message sequence, and updated time.
  Its `requestSequence` and `completedSequence` refer to transcript milestones. Completion is unread
  when it follows `seenThrough`; a request remains pending until a user reply clears its sequence.
- `ChannelTask` has a short, stable, channel-unique ID such as `t12`, title, status, optional owner
  and subtasks. Its optional `artifactId` is a shared artifact's `id`; file metadata
  stays with the artifact. Its optional `diff: DiffStats` uses `shared/diffStats.ts`, like Session
  diffs, and measures directly attributed work. `channelTasksDiff` derives totals from direct
  and descendant diffs, never storing aggregates. Unreported work differs from a measured zero;
  totals summarize reported work, not necessarily the net repository diff.
- Task timing belongs to the committed tree: server-owned `startedAt` begins on entry to
  `in_progress`, survives edits, moves, replacements by ID, and blocking, and clears on done or
  reset to pending. Clients derive age from this
  timestamp; compact agent reads expose derived `elapsedMinutes` instead of the timestamp.
  The lead may independently set an optional UTC `checkInAt`. The existing minute wake check
  atomically clears due check-ins on assigned, in-progress tasks, then privately asks each owner
  for progress. Pending and blocked tasks do not dispatch check-ins. Task age continues; another
  check-in requires another timestamp. Completion clears it; null cancels it. Checklists retain
  `X / Y`: elapsed minutes / minutes until check-in, then elapsed only once consumed.
  Wakes use the existing best-effort delivery guarantee, not a durable notification outbox.
- `ChannelAgent` is the shared public identity of anyone on the team, the lead or a member: ID,
  name, role, avatar, and status. A Channel's agents, lead first, form its team, which the overview
  presents as Team members.
- `ChannelLead` is the fixed public identity of the intrinsic lead. Its Worker and Session ID is the
  Channel ID. Its model belongs to the Channel.
  Its read position and status live in the lead Worker metadata. The lead is not a member and never
  produces membership messages.
- `ChannelMember` is the current public projection of one Channel-owned Worker. The Worker ID is also
  its private Session ID and public Agent ID. The projection contains its name, optional role,
  model, avatar, and collaboration status. Its read position stays private in Worker metadata.
- `ChannelMessage` has a durable ID and transactionally allocated sequence. User and Agent messages
  contain Markdown and optional image or video attachments. Typed system messages record name, purpose,
  directory, preview, membership, and artifact changes. Agent senders retain only their stable Worker ID, so deleting
  a member preserves prior content while the UI presents a deleted identity.
  `tasks_completed` records the task list becoming complete. The lead flags an ordinary message with
  `request: true`; `requestSequence` points to that question until a user replies.
- `ChannelReaction` is one Agent's durable acknowledgement or sentiment on a user or Agent message.
  It does not wake anyone or advance message sequence.
- `ChannelArtifact` indexes a shared `WorkspaceFile` by its `id` (the file's identity), with its
  title and when it was first shared; sharing it again changes only the title. Every artifact
  carries its `id`, so tasks, apps, and native clients never derive it. Files owns the address and
  editor. Channels owns only the shared index and the `artifact_shared` transcript event, whose own
  timestamp records the share.
- `ChannelRoutine` is scheduled, recurring work that serves the purpose: a short title, a prompt, and
  a local-time cron schedule with one fixed minute, so it runs at most hourly. Adding, changing, and
  deleting one each append a typed system message that shows its title. Only the lead adds or changes
  routines. The user can run one immediately or delete it.
- `ChannelState` is the canonical reduced detail: Channel metadata, lead, members, messages,
  pending request, artifacts, routines, presence, and revision. A snapshot is a state value at one
  instant, not a separate type. Earlier messages page by sequence; revision is the durable replay cursor.

There is no separate Agent or membership database. Workers persists ownership, name, and opaque
metadata. Channels validates that metadata as role, model, avatar, `seenThrough`, and status, then
projects it into the fixed lead or an editable `ChannelMember`. `model/worker.ts` owns these pure
projections for persistence and runtime configuration; private read positions stay out of public members.

## Algebra

### Channel and team

- Create a Channel and its lead together, then immediately start the lead. With a purpose, the lead
  frames the current work and begins. Without one, the lead asks the user what they want to work on.
- Edit a Channel's name, purpose, and lead model; list, read, and delete Channels. The sidebar and
  overview offer the same channel menu and open the same create/edit form. Only the lead can change
  the Channel's working directory through its `update_channel` tool; the form shows it read-only.
  Existing private Sessions keep their provider and history. Model and directory changes take effect
  at each agent's next execution, not during active work.
- Let only the lead among Channel agents rename the Channel, revise its purpose, or change its
  working directory. Name, purpose, and directory changes create a durable system message;
  preview changes also create a system message, like sharing an artifact. Ordinary task updates
  stay out of the transcript and do not create unread state or list movement.
- Let the lead add, update, remove, and move tasks by ID with `edit_channel_tasks`, committing an ordered
  batch against the latest tree. Updates preserve omitted fields and children; null clears optional
  fields. Removal deletes a subtree; moving appends it intact at the root or under a parent outside
  that subtree. Reserve `update_channel`'s whole-tree replacement for initial
  planning or restructuring, preserving retained IDs and outcomes.
- Create, edit, start, finish, and remove Channel members through their owned Workers.
- Let ordinary Sessions create and staff Channels, then read, post, share, and wait for the lead or
  members on the user's behalf. Let the lead create peers within its own Channel.

Selecting an unknown mention creates a member in that Channel and immediately starts its private
Worker Session for onboarding. The member reads context and establishes missing profile details, then
works on any assignment already received or finishes quietly. Idle membership is not a waiting status.
Mentioning a current member delivers instructions through the ordinary Session mailbox. Removing the member deletes that Session and Worker.
Members never exist outside their Channel and cannot be invited from a global pool. The intrinsic
lead exists for the Channel's lifetime and is addressed as `@lead`.

### Messages

- Append user, Agent, and typed system messages with one transactionally allocated sequence.
- Route every message through one pure `resolveChannelAudience` policy. An unmentioned user or member
  message wakes the lead. An unmentioned lead message wakes nobody. Explicit name-derived mentions
  wake exactly those agents, while `@everyone` wakes the lead and all members except the sender.
  The composer resolves the same policy for its draft, so it shows exactly who a message will wake.
- Set or clear one reaction per Agent without advancing transcript state.
- Register durable artifacts once and surface later file edits automatically. Attach screenshots,
  other images, and recordings to messages; generated images are attached by their saved paths.

### Status and reading

- Set or clear one member status without moving the Channel list or waking peers.
- Advance human and Agent read positions monotonically.

### Attention and completion

- Let only the lead flag a user request or complete the task list. A flagged request commits with
  its message, and the completing task update appends `tasks_completed`. Both travel through the
  normal detail stream without ending the lead's turn.
  Reading a completion message acknowledges its sidebar indication. Reading a request does not:
  any later committed user message acknowledges it and also reaches the lead, preserving any
  explicitly mentioned recipients.
  Acknowledgement does not imply that the user's response resolves the request.

### Scheduled wakes

- Wake an agent privately when its follow-up comes due, or the lead when one of its routines comes
  due or the user runs it, through ordinary Session delivery. A wake adds nothing to the transcript,
  and the agent posts only if something needs the channel. Running a routine leaves its schedule
  unchanged.

## Agent execution

`server/agent.ts` composes current Channel identity, purpose, working directory, collaboration
instructions, explicit model, and tools whenever a private Session starts an execution. Application
configuration composition resolves workspace model defaults while preserving an existing provider.
Sessions owns directory fallback and applying configuration between executions. The lead can
inspect the same model catalog as the client before creating peers. Member profile and Channel
directory changes apply between executions without mutating provider history. The lead receives its
fixed identity and responsibilities from the Channel rather than editable Worker metadata. Among
Channel agents, it alone creates members and updates the directory, public purpose, tasks, and
preview.

A directory is optional. Channels records a provided directory without creating it. When the work
needs one and none was provided, the lead can create and assign it through `update_channel`.

The collaboration protocol asks an agent to read current context at turn start, use the smallest
useful public action, set status only for substantive work, reread before a result or handoff, mention
members whose wait it fulfills, and finish every turn explicitly. Agent `read_channel` defaults to
unread messages, `unfinishedTasks` assigned to the caller (all unfinished tasks for the lead), and
working or waiting agents. Task ancestors retain assignment context; idle message authors remain
identified by name and mention. With a zero read cursor it always returns full context, even when
compact is requested. `detail: "full"` also includes Channel metadata, the complete task tree,
roster roles, artifacts, and routines for reorientation, planning, and final review. Never replace
the task tree from `unfinishedTasks`. Both views use the same forward read cursor and attachments;
passive Session reads retain their full context and backward paging. Public messages, reactions,
statuses, artifacts, and attachments are the only peer communication contract. Private transcripts
and tool logs never enter the Channel. Model-facing message tools cap posts at 3,000 characters so
durable long-form work stays in canonical shared artifacts; browser messages retain the Channel
model's 12,000-character limit.

The built-in lead role establishes the purpose with the user when needed, scales planning to the
work, keeps a lightweight task list with reviewable outcomes, creates each member only when their
work is actionable, drives quality through review and iteration, and keeps the public progress
surfaces current.
Each sibling list is capped at 50 tasks; use ID-based moves to regroup growing lists into milestones without discarding
useful outcomes or copying child counts into a parent's direct diff.
Routines serve the purpose, so setting one never rewrites the purpose or adds tasks.
Delegation never transfers accountability for the purpose or the quality of a member's outcome.
During working communication, the lead flags what it needs from the user by setting
`request` on `send_channel_message`; the same transaction appends that flagged message and updates
the pending cursor. Only the lead's version of the tool accepts the flag. Completion
needs no separate operation:
when a lead's task edit or replacement takes the list from incomplete to complete, meaning it has
tasks and every task and subtask is done, the same transaction appends `tasks_completed`. Completion
compares the committed tree before and after the entire batch, never intermediate edits. Rewriting an
already complete list never repeats it; reopening and finishing a task does.

A turn start clears only a prior waiting status. Session completion clears any remaining working
status; startup clears working status left behind by inactive executions. `finish_agent_turn` clears active status and its
projected activity reaction, or leaves a concise waiting status. The agent then ends its turn normally;
provider-enforced terminal execution is temporarily disabled pending
[github/copilot-cli#4755](https://github.com/github/copilot-cli/issues/4755). The lead and members
share the same tool: no arguments goes idle, `waitingFor` waits without a timeout, and adding
`wakeAfterMinutes`, from 5 to 120, schedules a follow-up on a teammate or external work. The follow-up
is the waiting status's `wakeAt`, so any earlier wake clears it. Agents do not schedule follow-ups
while waiting on the user. Unmentioned user replies wake only the lead; members ask the lead to
surface their request and mention them when they can continue.

## Persistence and streaming

Channels owns its schema, database operations, sequence allocation, delivery policy, tools, pane, and
sidebar panel. Workers owns managed Session identity and lifetime. Sessions owns execution, history,
streaming, completion, and worktrees. Workspace owns pane placement and cross-feature synchronization.

Channels spawns the lead and members through Workers with durable retention. Its admission callback
commits the Channel and lead together, or a member and its membership message together, before
execution begins, and returns the committed Channel or member through the Worker receipt. Removing a
member transactionally changes the Worker record and appends its typed system message.
Removing a member also clears that member from task ownership. Profile and status changes update
Worker metadata and advance the Channel revision. Deleting a Channel removes its rows and Worker
ownership together, publishes one deletion, then tears down every captured agent Session. Those
teardowns cannot produce member departures for the deleted Channel. Name, purpose, and directory
changes update Channel metadata and append a separate typed system message for each changed property
in one transaction, advancing sequence and revision for each; a user purpose change also wakes the lead
to read the new direction. Preview changes append `preview_changed`; tasks and lead-model changes
have their own revisioned events without a transcript entry. Human read-position advances also
have a revisioned event carrying only the committed cursor.
Private Agent read-position changes update only Worker metadata. Message, reaction, and artifact tables continue
to reference the stable Agent ID without a foreign key so authored history survives member removal.
Routines keep a server-private `next_at`. A 60-second interval from `server/startup.ts` claims due
follow-ups, routines, and task check-ins in one transaction before delivery: a follow-up clears its
waiting status, a routine moves past now, and a task check-in clears its timestamp. Routine runs
missed while stopped collapse into one.

The database is authoritative. Lead metadata updates and attention operations authorize against the
Channel's intrinsic lead ID within their transaction. Task edits and replacements also validate
owners and shared artifact references in that transaction. Tasks stay in the Channel's JSON column;
granular commands publish the same full-tree `tasks` event as replacement. Outcome-only updates
stay quiet and unchanged edits allocate no revision. The list query returns metadata and members
for the sidebar. The fixed lead identity is derived from the Channel ID.
Commits persist the reducer's request and completion cursors alongside their messages; reads select
those cursors directly. The snapshot retains request content by that sequence, while transcript
presentation separately distinguishes each historical request's acknowledgement.
A visible pane observes a `ChannelState` through one streamed Query: the first connection supplies
the snapshot, and later connections resume the cached revision. The server commits canonical rows
and publishes transitions, reusing metadata and roster reducers without retaining a second aggregate.
The same catalog projection supplies list snapshots and existing `channel.upserted` events for
messages, reads, and metadata edits. One publisher forwards committed detail events and their catalog
projections. Member upserts/deletions patch identity-only catalog members (ID, Channel ID, name,
avatar) without refetching the list. The sidebar gets activity from workspace sessions; descriptive
status belongs to the detail stream. Attention needs no additional workspace event or detail state.
`useChannels()` composes the catalog and workspace activity into entries with a Channel, its agents
and their `isRunning` flags, and a derived `status` (waiting for a reply, unread completion, or unread
messages). The sidebar and Apps SDK share this hook and the same caches. Badge text and suppression
of unread/completion badges for open panes stay in the sidebar.
The route loads the catalog before subscribing to workspace events. Live events patch that cache;
an event overlapping a refetch triggers TanStack's native replacement refetch. Reconnects refresh
the complete catalog. Create/edit responses invalidate it rather than replay potentially older
rows over live updates. Message and read cursors are not catalog versions.

Message sequence is transcript order and the basis of paging and read positions. Revision is detail
state order and advances for every durable public change, including tasks, model, shared reads,
reactions, profiles, and statuses. A bounded replay ring repairs changes missed by a reconnecting
client, including reactions on older loaded messages. Presence is transient and refreshed on arrival.

Agent reads move forward from private `seenThrough` and advance it. Passive Session reads page
backward without changing read state. Agent-facing projections use `agentId` for both the lead and
members, matching message senders, reactions, and waiting. These projections expose exact mentions,
roles, and effective statuses, never separate private Session IDs or another member's read position.
Artifact shares and reads expose
`artifactId` alongside the path and title, so the lead can attach the same file identity to a task.
Task-edit receipts return only the targeted IDs.
Presence governs working/waiting/idle for clients and tool projections; stored status supplies text
and message targets only while its state matches that presence.

### Shared client protocol

`GET /api/v1/channels` exposes the existing catalog as
`{ version: 1, channels, members, lead, working }` for client channel selection, using the same
list operation as browser RPC. `lead` is the profile every Channel's lead shares, with the
Channel's ID as its own, so clients draw leads of Channels they haven't opened without keeping a
copy. It never appears in `members`. `working` names the
leads and members whose sessions are running, the same fact presence uses, because native clients
cannot read the workspace session state the browser's sidebar uses for closed Channels.

An avatar is `{ mark, color }`, where agents author both and clients stroke the mark in whichever
of black or white contrasts more with `color`. Toy Box's own profiles may add `ink`, a fixed mark
color the lead uses for its gold star. Agent-authored avatars never carry it.

`GET /api/v1/channels/:channelId` streams SSE for browser and native clients through `streamChannel`.
Its snapshot event carries a `ChannelState`; snapshots are part of the stream protocol.
The snapshot includes the latest 100 public messages, roster, artifacts, routines, live presence,
and the pending request even outside that message window. Its durable facts come from one
transaction. Reads never acknowledge the Channel or expose private Agent context. Artifacts carry
the `id` that tasks reference as `artifactId` and a Files serving URL, so clients match task
outcomes without knowing the file identity encoding. Each attachment is either `{ name, url }` for
a file or `{ mimeType, base64 }` for an inline upload. Stored paths remain available only in the
agent tool projection.

The stream establishes state and follows changes:

- No cursor: send `{ type: "snapshot", state }` with one complete `ChannelState`.
- `after` or `Last-Event-ID` (including zero): replay contiguous durable events, then send current
  `{ type: "resumed", presence }`, including explicit idle agents. An unavailable
  replay becomes a replacement snapshot; clients discard older loaded history and can page it again.
- Live durable events forward directly. The observer keeps only the roster needed to project
  runtime presence; it does not reread metadata or history on each event. Presence updates send
  only changed agents. Subscribe before reading so changes during bootstrap follow its coherent view.
- Deletion sends `{ type: "deleted", channelId }` and closes, including when the Channel is already
  absent on connection. Workspace deletion also removes closed panes.

`reduceChannelState` applies the complete public protocol: messages derive metadata and attention,
quiet events replace tasks/model/read state, and presence updates merge or replace the presence map.
The separately retained pending request follows replies and reactions even outside the message window.
Optimistic posts enter the reducer with their client-generated message ID without advancing server
cursors or clearing attention; the committed echo replaces that message and applies its authoritative
position and metadata. Older pages merge already-materialized messages without replaying their events.
`useChannel()` exposes the live state, unread boundary, history paging, and `postMessage` bound to
that Channel. Posting supplies the message ID and invokes the shared mutation; the composer owns
only its draft and submission UI. The app SDK exports this same hook. Observation defaults to
`"active"`; visualizations use `mode: "passive"` to leave unread state untouched.
The server reuses the metadata and roster reducers at their owning boundaries; SQLite remains its
source of truth without a second live Channel aggregate. Resource URLs are resolved on the server.

TanStack Query owns the browser's cached view, stream request, cancellation, and retries through
`streamedQuery` with append semantics. `stream.ts` adapts the same SSE endpoint Minecraft uses into
an async generator; each attempt reads the latest cached revision, and unexpected EOF retries.
There is no separate browser snapshot RPC or alternate native-client protocol.

The browser's `ChannelQueryData` adds an arrival record to the state: a connection identity and the
unread boundary after its initial snapshot or post-replay `resumed` event. Replayed shared reads
therefore arrive before the browser captures that boundary. Paging, optimism, and later sparse
presence updates cannot masquerade as arrival. A terminal deleted event leaves a null detail value
and removes the catalog entry; Workspace deletion also retires the detail query. Both catalog paths
replace an overlapping stale list read. This browser metadata does not change the public protocol.

`GET /api/v1/channels/:channelId/messages?before=<sequence>` returns up to 100 older messages with
`{ version: 1, revision, messages }` from one transaction. The browser uses this same public endpoint.
It retries pages older than its cached revision, merges without advancing the stream cursor, and
continues through the target sequence when revealing a pending request.

`POST /api/v1/channels/:channelId/messages` accepts `{ id, content, attachments? }`, uses the normal
user-message schema and delivery policy, and returns HTTP 201 with `{ version: 1, message }`.
Duplicate IDs return 409 without repeating delivery. `POST …/read` accepts `{ sequence }`, uses
the same monotonic read operation as the browser, and returns `{ version: 1, seenThrough }`.
Reading acknowledges completion but never answers a request. HTTP and RPC are thin entry points
to these capabilities under Toy Box's existing trusted-owner server assumption.

Native clients manage Channels through the same operations as the browser's channel menu, member
editor, mention completion, and routine actions:

- `POST /api/v1/channels` creates a Channel from `{ name, purpose?, directory?, model }` and starts
  its lead (201 `{ version: 1, channel }`). `PATCH /api/v1/channels/:channelId` edits its name,
  purpose, or lead model (`{ version: 1, channel }`), and `DELETE` removes it (204).
- `POST …/members` creates a member from `{ name, role?, model? }` and starts its onboarding (201
  `{ version: 1, member }`). `PATCH …/members/:agentId` changes its name, role, or model (null
  inherits the workspace default), and `DELETE` removes it (204). Both reach only members of the
  routed Channel; the intrinsic lead is never one. Once a member's session exists, its provider is
  fixed: an explicit model from another provider returns 422. Clearing the override with
  `model: null` remains allowed: Sessions follows a compatible workspace default or retains the
  existing provider's model and history when that default belongs to another provider.
- `GET …/members/:agentId/models` returns `{ version: 1, provider, models, defaultModel }` scoped
  like the browser's member editor: `provider` is the session's provider, else the configured
  model's, else null for no restriction. `defaultModel` is null when no compatible workspace
  default is available; it describes a model choice, not permission to clear an override.
- `POST …/routines/:routineId/run` wakes the lead with that routine now, and `DELETE
  …/routines/:routineId` removes it (204, or 404 when it is already gone).
- `GET /api/v1/models` returns `{ version: 1, models, defaultModel }`, the provider catalog and
  normalized workspace default that the browser's model pickers offer. Providers owns this route,
  its response, and the projection reused by the member-scoped endpoint.

Bodies cannot name the identities in their route. Malformed bodies return 400, missing Channels,
members, and routines return 404, and domain rejections such as a taken mention return 422 with
the same message the browser shows. Unexpected management failures are logged server-side and
return 500 with a generic `{ error }`, never an internal exception message. A failure can follow
a committed change, so clients refresh authoritative state rather than automatically retrying writes.

## Native push delivery

Channels lazily publishes committed request/completion milestones; the three-second unread check
runs only for subscribed topics. `channel:<id>` opens one stream on first interest and closes it on
last interest. Its initial snapshot includes the latest messages, but only metadata, roster and
presence are retained for push. A workspace listener publishes the existing catalog's waiting count
after channel upserts/deletions, covering replies and removals without opening streams for every
channel. Reading does not close a request. No separate catalog cache or scheduler is added.
Delivery belongs to [Push](../push/AGENTS.md). Channel payloads live in `model/push.ts`, with four
ChannelKit wire fixtures in `model/__fixtures__/push-*.apns`.
After the unread check, alert text uses the current channel name, the Mac's 400-grapheme plain-text
request policy and attachment fallbacks, completion task-count wording, and the requester's handle.
Deletion publishes an end through the normal 100ms debounce and dismisses at its push timestamp.
Completion and removed-task endings retain their content for fifteen minutes.

## Presentation

`ChannelPane` takes a Channel ID and owns one cached `ChannelState` for its transcript, overview,
and composer. It does not read the workspace catalog or derive agent presence from Session state.
The sidebar uses the catalog and workspace activity independently; private Session previews and
Files remain explicit integrations with their own capabilities. `ChannelPaneContext` shares one
roster, presence, and the composer actions inside the pane. The roster exists from the first
render, starting from the intrinsic lead, so the composer, transcript, and overview never derive
their own.
The composer shell and its intrinsic "To Lead" audience render during SSR. Hydration starts
observation; the first snapshot populates the tray and roster and enables input.
It uses the same shared composer shell and native `ComposerInput` as Sessions. Agent mentions remain plain `@handle`
text, so audience resolution and delivery are unchanged. The draft is the Workspace saved draft
`channel:<id>`, so it survives reloads and follows the user across clients; reply and mention
actions edit it through the draft's verbs. The composer owns the member-creation mutation and
binds it into one pure source. `agentCompletionSource.ts` owns the whole mention policy:
everyone, the lead, matching members by name, and an offer to create an unknown handle, whose
acceptance creates the member and resolves to its mention. The completion hook owns that
acceptance's in-flight guard and error, which the shared menu shows. Its trigger is the model's
`AGENT_MENTION_TRIGGER`, built from the same mention grammar that parses and delivers mentions,
so the menu completes exactly what delivery wakes. Each item's description is the agent's role or
what the option does. `AgentCompletionMenu` supplies avatars and edits a member by opening its
editor through the shared `CompletionMenu`, which shares menu chrome, item text, editing, group
headings, active-item scrolling, and focus-preserving click/tap acceptance with Sessions; touch
scrolling never commits a mention. An agent editor opened from the menu outlives the menu it was opened from.
The input grows through three rows and retains the existing toolbar typing effect.

The workspace deduplicates Channel panes by Channel ID. Panes and apps share one Query
stream. `subscribed` detaches hidden views, and Query cancels when the last observer leaves;
cached content and mounted drafts remain. On return, replay catches up that cache and establishes
the unread boundary before read acknowledgement or initial unread scrolling. A reader joining an
existing observer captures the current shared read cursor. Arrivals during reading do not move that boundary. A deleted event
ends observation and reaches the pane's existing unavailable boundary.

`ChannelUserMessage` adds mentions, reactions, and timeline timestamps to the shared
[`UserMessage`](../../shared/messages/UserMessage.tsx); agent messages reuse the shared
[`CopyControl`](../../shared/messages/CopyControl.tsx). `ChannelReactions` takes a message and
shows its recorded and projected reactions, or nothing. Every agent reference, whether an author,
reactor, task owner, or sharer, resolves through `channelAgentIdentity`, so a removed agent
presents one deleted identity everywhere.

- The transcript's rows come from `transcriptRows`, its pure presentation model: each user message
  stands alone, one agent's consecutive messages form a run, and matching system messages merge.
  Each message in a run carries its addressee, its body without the leading mentions that addressee
  names, its request state, whether it repeats the run's header, and whether it collapses. One
  optional divider precedes a row, labeling a new day, marking where unread messages begin with a
  blue rule and "New", or both at once rather than stacking two rules. `SystemMessageGroup` defines
  each kind's static icon and presentation function together in one local object; each function
  receives its kind's typed contents. Its shared row renders the resulting content and tooltip;
  grouping and the durable message model stay separate.
  A pane-local view, chosen beside the overview's trigger and hidden with it while pinned, shows
  all messages or only the user's own and the agent messages that never collapse. Rows form from
  the shown messages, so runs and dividers follow what the reader sees; changing the view lands
  the transcript afresh, and read state stays Channel-wide.
  `useTranscriptViewport` owns the virtualizer and where the reader looks: landing on the first
  unread row or the end, following the reader's own post, revealing the pending request, and
  paging history. Paging continues while the first row, or an empty view, is in view, so a sparse
  view fetches pages it may show nothing of instead of asking the server to filter.
  TanStack Virtual's mutable instance stays inside that hook, which the compiler
  skips, and the transcript receives only values current for its render.
  The "New" position comes from the current read position on arrival and holds
  while it's read, so arrivals during reading are never marked. A flagged question is marked until a
  later user message acknowledges it. The activity row shows working agents; waiting
  shows in the overview, since a request already marks what the user needs to answer.
- The composer docks Workspace's [`ComposerTray`](../workspace/components/outputs/ComposerTray.tsx)
  for shared artifacts, newest first, plus the tasks and preview. URL previews
  retain their sandboxed hover iframe and open in a new tab. Screen previews
  show a passive live canvas and open/focus a Screen pane without opening a
  private agent Session. Tray, overview and historical preview messages share
  Workspace's preview presentation. Opening never takes input control.
  While the Channel reports a pending request, it asks for a reply.
  An "Input needed" button beside the composer's audience stays visible
  until the user replies. Hover previews `state.request`; clicking loads
  any older pages needed and scrolls to the question. Scrolling never changes the composer height.
- The overview opens as a sheet or pins beside the transcript, which the workspace layout remembers.
  Both presentations use the shared vertical scroll fade.
  It shows the purpose, directory, and preview, then the team with its presence, the shared
  artifacts newest first by when each was shared, the tasks, and any routines by title with their
  next run, each expanding to its prompt and offering Run routine and Delete routine. A waiting agent
  shows when its follow-up checks back. Team members, Task list, Artifacts, and Routines each
  collapse independently through their heading, with all four expanded by default. Counts and task
  diff totals remain visible while collapsed. The Task list's count badge independently toggles
  an in-progress-only view, retaining and initially expanding every ancestor of an active task.
  A blue dot and pressed state mark the active filter. Filtering changes visibility only: count badges
  still describe their complete sibling lists, and diff totals remain unfiltered.
  No matches reads "No tasks in progress."
  The Team members count badge similarly toggles working agents only, using live presence and retaining
  lead-first, alphabetical order. Its count still describes the complete team, and no matches reads
  "No agents are working."
  Both filters start off and leave section disclosure independent.
- Both checklists share a task projection with stable identity and compact diff totals (exact counts
  on hover and for assistive technology). The shared checklist owns filter visibility and muted
  italic empty-message styling; hosts supply the message. Task running time has a leading clock icon,
  both in muted text. Naturally sized counts and owners float beside the first title line, without reserved
  columns. Pending rows omit diff counts; reported zeros use the same
  added/removed colors as other counts. Counts and avatars keep their normal colors on done rows.
  Artifact references stay on their directly attributed tasks and never roll up. Artifact icon actions
  share that detail slot and open ordinary file panes without toggling the parent; their hover
  and accessible labels identify the artifact, while full titles stay in the artifact list.
  Inline disclosures keep direct-child progress with the title in the same count badge as section
  headings; a parent's own artifact action remains visible while collapsed. The overview and popup
  share a heading layout with a count badge and the whole-list diff at the right. The progress bar
  appears only in the desktop composer-tray pill.
- Sidebar priority is waiting, unread completion, ordinary unread, then live lead/member activity;
  open channels suppress completion like unread, but never suppress an unanswered request.

## Code map

- `model/` is the isomorphic domain. `index.ts` owns the types, input schemas, audience policy, and
  public exports. `tasks.ts` owns task identity, outcome schemas, derived diff totals, tree edits,
  ownership release, and completion. `agent.ts` owns agent names, roles, avatars, the lead profile, mention
  handles, and the deleted identity an ID resolves to once its agent is removed. `worker.ts` projects Worker metadata into the lead, members, and roster. `reducer.ts`
  reduces the complete public snapshot and owns the metadata and roster transitions shared with
  the server. `presence.ts` and `reactions.ts`
  derive how agents and reactions display.
- `server/` owns authority. `schema.ts` and `database.ts` own tables and transactions. `index.ts`
  composes the algebra for RPC, tools, and wakes. `functions.ts` is browser RPC ingress, and
  `stream.ts` composes public views and owns observation using `events.ts`'s detail replay ring.
  The versioned SSE route delegates to that owner through `api.ts`.
  `resources.ts` resolves client URLs before publication or snapshot delivery.
  `tools.ts` owns agent-facing projections and the Session, lead, and member tool sets; `agent.ts` composes each agent's
  execution, and `startup.ts` clears finished working statuses and starts the wake interval.
- `queries.ts`, `stream.ts`, `mutations.ts`, `queryCache.ts`, and `useChannel.ts` own client data:
  catalog and streamed detail queries, the SSE adapter, mutations, catalog event patches, and one
  open Channel's visibility and read lifecycle.
- `components/pane/` holds the pane, composer, and shared pane context, with `transcript/` and
  `overview/` beneath it. `components/agents/` holds avatars, mention Markdown, the mention
  source and menu, the member editor, and working agents. `components/sidebar/` holds the Channels panel and its
  attention priority. The top level holds the create/edit dialog and channel menu.
- Outside this folder, [Workers](../workers/AGENTS.md) owns agent identity and lifetime.
  [`sessionConfiguration.ts`](../../server/sessionConfiguration.ts) grants ordinary Sessions the
  Channel tools and resolves agent configuration, and
  [`managedSessions.ts`](../../server/managedSessions.ts) detaches a deleted agent's Session.
  [Workspace](../workspace/AGENTS.md) places the pane and sidebar panel and synchronizes
  `channel.*` events.

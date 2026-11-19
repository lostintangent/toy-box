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

Channels owns its schema, database operations, sequence allocation, delivery policy, agent tools and
instructions, pane, and sidebar panel. [Workers](../workers/AGENTS.md) owns managed Session identity
and lifetime. [Sessions](../sessions/AGENTS.md) owns execution, history, streaming, completion, and
worktrees. [Workspace](../workspace/AGENTS.md) owns pane placement and cross-feature
synchronization, and [Push](../push/AGENTS.md) owns delivery to devices.

## How a Channel unfolds

1. **Create.** The Channel and its lead commit together, and the lead starts immediately. With a
   purpose, it frames the work and posts a kickoff. Without one, it asks the user what to work on.
2. **Staff.** Once a member's work is actionable, the lead creates it with a focused role that says
   what it's responsible for and whom it takes work from and hands work to. The member onboards by
   reading the Channel and designing its avatar. A member that joins without a role, as from the
   composer, defines it once from the first request that gives it work, and the lead owns it after
   that. When the purpose changes, the lead reviews every role against it.
3. **Coordinate.** One audience policy routes every message, and mentions wake exactly the agents
   they name. A woken agent runs one private turn: it reads the Channel, acts publicly, and
   finishes, optionally leaving a waiting status.
4. **Involve the user.** The lead sends a question flagged as a request, or posts a result and
   completes the task list. The sidebar holds each until the user replies or reads it.
5. **Keep going.** Follow-ups privately wake waiting agents and routines wake the lead on a schedule,
   so ongoing work advances without anyone posting.
6. **Close.** Completing the task list is the lead's evidence-backed judgment that the work is done,
   not a relay of members' reports. Done work stays while its batch of work is current, so the list
   shows where that batch stands. When the next batch begins, the lead retires each done top-level
   task whose outcome is recorded elsewhere, such as in a commit or doc, along with the artifacts and
   the role and purpose text that only served it, so the Channel describes current work. A subtask
   never retires on its own, so unfinished work carries into the next batch whole.

## Domain model

```text
Channel        name, avatar, purpose, directory, lead model, tasks, preview, user read position
├─ Team        the Channel's agents
│  ├─ Lead     intrinsic and fixed; its Worker and Session ID is the Channel ID
│  └─ Members  created on demand; editable and removable
├─ Transcript  sequenced user, agent, and system messages, plus agent reactions
├─ Artifacts   shared workspace files
└─ Routines    scheduled prompts that privately wake the lead
```

- `Channel` owns its name, avatar, optional purpose and working directory, lead model, public tasks,
  optional URL-or-screen preview, the user's read position `seenThrough`, latest message sequence,
  and updated time. Its `requestSequence` and `completedSequence` point to the pending request and
  the latest completion, which [Attention](#attention-and-completion) defines.
- `ChannelAvatar` is a mark the lead designs or the project's own icon. Until the lead sets one,
  every surface draws the cyan `#` mark, and the lead can replace an avatar but not clear it. An
  image is a PNG, JPEG, or WebP of at most 256 KB, kept at
  `~/.toy-box/channels/<channelId>/avatar-<hash>.<ext>` so a new image gets a new URL. The row and
  its `channel_avatar_changed` message store only that name, clients receive its server-relative
  URL, and the image stays until its Channel is deleted, so each announcement keeps showing it.
- `ChannelTask` has a short, stable, channel-unique ID such as `t12`, title, status, optional owner
  and subtasks. Its owner is a `ChannelActor`: an agent, or the user for a task that waits on the
  user, which checklists show as You. Its optional `artifactId` references a shared artifact. Its
  optional `diff: DiffStats` uses `shared/diffStats.ts`, like Session diffs, and measures directly
  attributed work. `channelTasksDiff` derives totals from direct and descendant diffs, never storing
  aggregates. Unreported work differs from a measured zero; totals summarize reported work, not
  necessarily the net repository diff.
- Task timing belongs to the committed tree: server-owned `startedAt` begins on entry to
  `in_progress`, survives edits and moves by ID while the task stays in progress, and clears when it
  leaves, so resuming starts a fresh timer. Clients derive age from this timestamp. No tool output
  carries it, and compact agent reads expose derived `elapsedMinutes`. The lead may independently
  set an optional UTC `checkInAt`, which [Scheduled wakes](#scheduled-wakes) consumes.
- `ChannelActor` is who acts in a Channel: the user, or an agent on the team by ID. It names a
  message's sender, a change's actor, and a task's owner. Only a sender may also be the system.
- `ChannelAgent` is the shared public identity of anyone on the team, the lead or a member: ID,
  name, role, avatar, and status. A Channel's agents, lead first, form its team. An avatar is
  `{ mark, color }`, the same shape as a Channel's mark avatar, and clients stroke the mark in black
  or white, whichever contrasts more with `color`. Only Toy Box's own profiles add `ink`, a fixed
  mark color such as the lead's gold star. `@user` and `@everyone` are reserved, so no agent can
  take either name.
- `ChannelLead` is the fixed public identity of the intrinsic lead, addressed as `@lead`. Its Worker,
  Session, and agent ID is the Channel ID, and its model belongs to the Channel. Its read position
  and status live in the lead Worker metadata. The lead exists for the Channel's lifetime, is not a
  member, and never produces membership messages.
- `ChannelMember` is the current public projection of one Channel-owned Worker. The Worker ID is also
  its private Session ID and public agent ID. The projection contains its name, optional role,
  model, avatar, and collaboration status.
- `ChannelMessage` has a durable ID and transactionally allocated sequence. User and agent messages
  contain Markdown and optional image or video attachments. Posting stores each as a file the
  Channel owns at `~/.toy-box/channels/<channelId>/attachments/<messageId>/<name>`, so it outlives
  its source, and a repeated name gains `-2`, `-3`. The message records only names; `attachments.ts`
  owns the rest of the path. A system message has no sender and records one typed change. Agent
  senders retain only their stable Worker ID, so deleting a member preserves prior content while the
  UI presents a deleted identity. A lead's message may be a request, which may also carry `replies`,
  two to four labels of up to 80 characters that become one-tap answers.
- `ChannelReaction` is one agent's durable acknowledgement or sentiment on a user or agent message.
  It does not wake anyone or advance message sequence.
- A bookmark is the user's private mark on a user or agent message, stored only as its sequence.
  The list lives on the Channel row but stays off `Channel`, so the catalog, sidebar, push, and
  agent tools never see it.
- `ChannelArtifact` indexes a shared `WorkspaceFile` by its `id` (the file's identity), with its
  title and when it was first shared. Every artifact carries its `id`, which tasks reference as
  `artifactId`, so tasks, apps, and native clients never derive it. Files owns the address and
  editor. Channels owns only the shared index and the `artifact_shared` transcript event, whose own
  timestamp records the share.
- `ChannelRoutine` is scheduled, recurring work that serves the purpose: a short title, a prompt, and
  a local-time cron schedule with one fixed minute, so it runs at most hourly.
- `ChannelState` is the canonical reduced detail: Channel metadata, lead, members, messages,
  pending request, bookmarks in sequence order, artifacts, routines, and revision. A snapshot is a
  state value at one instant, not a separate type. Earlier messages page by sequence; revision is
  the durable replay cursor.

There is no separate agent or membership database. Workers persists ownership, name, and opaque
metadata. Channels validates that metadata as role, model, avatar, `seenThrough`, and status, then
projects it into the fixed lead or an editable `ChannelMember`. `model/worker.ts` owns these pure
projections for persistence and runtime configuration. Agent read positions stay private: they
change only Worker metadata and never appear in members, rosters, streams, or tools.

## Algebra

Among Channel agents, only the lead changes the Channel's name, purpose, directory, tasks, preview,
avatar, and routines, flags requests, and creates, edits, and removes members. Receiving the lead
tool set is that authority, since a lead's Session ID is its Channel's ID, and lead metadata and
attention writes check the Channel's intrinsic lead ID within their transaction.

### Channel and team

- Create a Channel and its lead together, then start the lead. List, read, and delete Channels.
- The user edits the name, purpose, and lead model, and a user purpose change wakes the lead. The
  lead edits the name, purpose, directory, preview, and avatar with `update_channel`. A directory
  is optional, and Channels records one without creating it.
- Name, purpose, directory, preview, avatar, membership, artifact, and routine changes each append a
  typed system message. Task, lead-model, read, and status changes stay out of the transcript, so
  they create no unread state or list movement.
- The user and the lead create, edit, and remove members through their owned Workers, and selecting
  an unknown mention creates one. A new member starts onboarding in its private Session immediately.
- Removing a member deletes its Worker and Session, appends `member_left` with its remover as actor
  (the user when its Session is deleted elsewhere), and clears it from task ownership. Members never
  exist outside their Channel.
- Let ordinary Sessions create and staff Channels, then read, post, share, and wait for the lead or
  members on the user's behalf.

### Tasks

- Let the lead add, update, remove, and move tasks by ID with `edit_channel_tasks`, committing an
  ordered batch against the latest tree and validating owners and artifact references in the same
  transaction. Updates preserve omitted fields and children; null clears optional fields. Removal
  deletes a subtree; moving appends it intact at the root or under a parent outside that subtree.
  Each sibling list holds at most 50 tasks, and moves regroup a growing list into milestones without
  copying child counts into a parent's direct diff.
- When a lead's batch takes the list from incomplete to complete, meaning it has tasks and every task
  and subtask is done, the same transaction appends `tasks_completed`. Completion compares the
  committed tree before and after the entire batch, never intermediate edits. Editing an already
  complete list never repeats it; reopening and finishing a task does.

### Messages, artifacts, and status

- Append user, agent, and typed system messages with one transactionally allocated sequence.
- Route every message through one pure `resolveChannelAudience` policy. An unmentioned user or member
  message wakes the lead. An unmentioned lead message wakes nobody. Explicit name-derived mentions
  wake exactly those agents, while `@everyone` wakes the lead and all members except the sender.
  The composer resolves the same policy for its draft, so it shows exactly who a message will wake.
- Set or clear one reaction per agent without advancing transcript state.
- Bookmark or unbookmark a user or agent message idempotently, without changing Channel metadata,
  attention, or delivery.
- Share a file as an artifact; sharing it again changes only its title. Removing one, through the
  lead's `remove_channel_artifact` or the user's overview or `DELETE`, unshares it, leaves the file
  on disk, and records its actor in an `artifact_removed` message whose reducer unlinks task
  references, as `member_left` does.
- Set or clear one agent status without moving the Channel list or waking anyone.
- Advance user and agent read positions monotonically.

### Attention and completion

- Let only the lead flag a request: `request: true` on its `send_channel_message` commits the message
  and moves `requestSequence` in one transaction.
- A later committed user message clears the request and reaches the lead, preserving any explicitly
  mentioned recipients. Reading never answers a request, and acknowledging one does not mean the
  reply resolved it.
- A completion is unread while it follows `seenThrough`, and reading it acknowledges it. A user
  message reads the Channel through itself, so a reply from the sidebar or a notification never
  leaves it unread.
- Both travel through the normal detail stream without ending the lead's turn.

### Scheduled wakes

- Wake an agent privately through ordinary Session delivery when its follow-up comes due, the lead
  when one of its routines comes due or the user runs it, and a task's owner when its check-in comes
  due. A wake adds nothing to the transcript.
- A follow-up is a waiting status's `wakeAt`, set by `finish_agent_turn`'s `wakeAfterMinutes`, so
  any earlier wake clears it. Only the lead adds or changes routines; the user can run one now,
  which leaves its schedule unchanged, or delete it. A check-in fires only on an assigned,
  in-progress task; completion clears it, null cancels it, and another needs another timestamp.
- A 60-second interval from `server/startup.ts` claims due follow-ups, routines, and check-ins in
  one transaction before delivery: a follow-up clears its waiting status, a routine moves its
  server-private `next_at` past now, and a check-in clears its timestamp. Routine runs missed while
  the server was stopped collapse into one.
- A wake command is a shell command an agent starts with `run_wake_command`, at most one per agent.
  `server/wakeCommands.ts` runs it in the agent's working directory in its own process group,
  writing stdout and stderr to `command.stdout` and `command.stderr` in the agent's state folder.
  The next command overwrites both, which the tool's result tells the agent.
  Its exit wakes the agent whether or not it's still waiting, with a `channel_wake_command` that
  names the command and carries its exit code and both paths, never the output, and that no other
  queued wake absorbs. A new command replaces it. Replacement, removal and shutdown kill its whole
  process group without a wake, at once rather than through `stopProcess`'s TERM and grace period,
  since no step after a stop may run. The group is frozen first so no shell in it starts another
  step, and shutdown awaits the exit. A server that dies without shutting down, as when a second
  Ctrl-C cuts Nitro's close short, its terminal closes, or it's killed, leaves that to a watcher: a
  detached `sh` the server holds a pipe to and never writes, which reads the pipe's end and kills
  the group.
  Its Worker metadata keeps the command until then, so a boot wakes the owner of a command its
  server stopped, naming it, with a null exit code. A waiting status set while it runs names it as
  `wakeCommand`, which the member list shows in place of a follow-up's countdown.

### Across Channels

- Let the lead list Channels with the same `list_channels`, including those on the owner's peer
  servers, and privately message another Channel's lead with `message_channel_lead`. A lead
  coordinates with another Channel through that lead, never its transcript.
- `message_channel_lead` delivers a `channel_lead_message` naming the sender's Channel to the target
  lead's Session, which replies the same way. The exchange stays in the two leads' Sessions, and the
  target must be an existing Channel because delivery accepts any Session. Like a routine run, the
  wake clears the receiving lead's waiting status, so its roster shows it working. That is the
  exchange's only trace in either Channel.
- Peer servers are the other Toy Box servers on the owner's tailnet, which
  [Workspace lists](../workspace/AGENTS.md#the-server). `list_channels` adds each answering peer's
  Channels with that server's `name` as `server`, so a sleeping computer lists none. Messaging one posts
  once to its server's [`lead-messages` route](#peers), and any answer but acceptance, or a timeout,
  fails the tool. The receiver wakes its lead without looking the sender up, and that lead replies
  through its own peers. Only words cross servers. Peers trust each other the way a server trusts
  its clients, on the owner's private network, without authentication.

## Agents

`server/agent.ts` composes each agent's identity, purpose, working directory, instructions, explicit
model, and tools whenever its private Session starts an execution. Application configuration
composition resolves workspace model defaults while preserving a started Session's provider.
Sessions owns directory fallback and applies configuration between executions, so profile and
directory changes never mutate provider history. The lead receives its fixed identity from the
Channel rather than editable Worker metadata.

### Instructions and tools

`server/tools.ts` gives each audience its own tool set: `channelTools` for ordinary Sessions,
`channelLeadTools` for the lead, and `channelMemberTools` for members. A Channel agent's tools are
always loaded, since every wake depends on them. `buildChannelAgentInstructions` composes the rest:

- `<channel_collaboration>`, the protocol every agent follows: Start, Contribute, Write, and Finish.
- `<channel_role>`, the agent's identity, the Channel's purpose, and its role and avatar, plus How to
  lead for the lead.
- `<onboarding_process>` while profile details are missing: a member's role or avatar, or the avatar
  of a lead whose Channel has a purpose.

`server/index.ts` supplies each agent's first message, which differs for a new lead and a new member.

A tool's description and schema say how to call it and what the call does, including whom it wakes.
The instructions say when to act and why: how the lead frames, staffs, delegates, reviews, and
closes work, how members take part, and when each tool fits. Keep every rule's reason beside it.
Repeat a tool's constraint in the instructions only when runs show a model ignores it otherwise.
Before landing a change to the instructions or tools, compare it against HEAD with the
[channel-lead scenario](../../../evals/scenarios/channel-lead.ts), which scores a lead and its
members against these rules. The [evals README](../../../evals/README.md) covers writing and running
an experiment. No scenario covers ordinary Sessions' `channelTools` yet.

### Reading and posting

Agent `read_channel` moves forward from the agent's private `seenThrough` and advances it, so every
view shares one cursor. The compact default returns what's new and open for the caller,
`detail: "full"` adds what reorientation and final review need, `detail: "tasks"` returns just the
complete task tree, and a zero cursor always returns full context. The tool description owns the
exact fields. Passive Session reads page backward without changing read state.

Public messages, reactions, statuses, artifacts, and attachments are the only agent communication
contract. Model-facing message tools cap posts at 3,000 characters so durable long-form work stays
in shared artifacts; browser messages keep the Channel model's 12,000-character limit.

### Handles and presence

Channel agents see and name every agent by handle, `@user` or an agent's mention, never an agent ID:
senders, actors, membership notices, and task owners are handles, and reactions, rosters, and member
edits key one as `agent`. A removed agent has no handle, so the field is absent. Rosters carry roles
and effective statuses. Tool inputs that name an agent, `agent` and task owners, take its mention,
and a task owner also takes `@user`. Every reader, Sessions included, sees one task tree whose owners
are handles. Otherwise Session tools keep agent IDs: rosters, created members, and waits carry each
`agentId`, reads carry stored senders and actors, and waits accept an ID or a mention.
`resolveChannelAgentId` maps either to the ID, which is all that is stored, published, or served.
Channel agents' write results carry only what the call didn't already know: a share returns its
`artifactId`, created members their handles, a member edit its handle, and other writes a word.

Presence governs working, waiting, and idle for clients and tool projections; stored status supplies
text and message targets only while its state matches that presence. `channelAgentPresence` derives
it from stored status and whether the agent's Session is running, so no stream carries it: tools and
push read server Session activity, the browser reads its Session activity, and native clients read
the catalog's `working`.

### Turn status

A turn start clears only a prior waiting status. Session completion clears any remaining working
status, and startup clears working statuses left behind by inactive executions. `finish_agent_turn`
clears active status and its projected activity reaction, or leaves a waiting status, optionally
with a [follow-up](#scheduled-wakes). It is a terminal tool, so its successful result ends the turn.

## Server

Channels spawns the lead and members through Workers with durable retention. Its admission callback
commits the Channel and lead together, or a member and its membership message together, before
execution begins, and returns the committed Channel or member as the spawn's `value`. Removing a
member deletes its Worker record and appends `member_left` in one transaction, then tears down its
Session. Deleting a Channel removes its rows and Worker ownership together, publishes one deletion,
then tears down every captured agent Session and deletes the Channel's files. Those teardowns cannot
produce member departures for the deleted Channel.

Each commit persists canonical rows and publishes its transitions, reusing the model's metadata
reducer. A metadata edit appends one typed system message per changed property in one transaction.
Tasks stay in the Channel's JSON column, and each edit batch publishes one full-tree `tasks` event;
unchanged edits allocate no revision. A read publishes only the committed cursor, a bookmark change
one `bookmarks` event that replaces the list, and profile and status changes update Worker metadata
and advance the Channel revision. Message, reaction, and artifact tables reference the stable agent
ID without a foreign key, so authored history survives member removal.

Commits persist the reducer's tasks and its request and completion cursors alongside their events,
so a `tasks` event or an unlinking message is the only way tasks change, and reads select them
directly. The snapshot retains the pending request's content by its sequence, while transcript
presentation separately distinguishes each historical request's acknowledgement. Row decoders
produce the public messages, artifacts, and requests that reads, snapshots, and live events share.

Message sequence is transcript order and the basis of paging and read positions. Revision is detail
state order and advances for every durable public change, including tasks, model, shared reads,
reactions, profiles, and statuses. Commits publish in revision order, so streams forward them
without repair, and any other order closes the stream. A bounded event log serves a reconnecting
client from its cursor, including reactions on older loaded messages.

One publisher forwards committed detail events and their catalog projections. The same catalog
projection supplies list snapshots and `channel.upserted` events for messages, reads, and metadata
edits. Member upserts and deletions patch identity-only catalog members (ID, Channel ID, name,
avatar) without refetching the list.

## Wire protocol

Each `routes/v1/` file answers its `/api/v1/channels` requests with the same operations as browser
RPC, under Toy Box's trusted-owner server assumption.

### Catalog

`GET /api/v1/channels` serves the catalog `{ channels, members, lead, working }`. Each entry carries
its `revision`, the Channel's detail revision, and `request`, its pending request message without
reactions, or `null`, but omits `tasks`, which only the detail stream carries. `lead` is the profile
every Channel's lead shares, with the Channel's ID as its own, so clients draw any lead without
keeping a copy; it never appears in `members`. `working` lists, sorted, the leads and members whose
Sessions are running, the fact presence uses, since native clients can't read Session activity.

The request chooses the representation: JSON by default with `Cache-Control: no-store`, or an SSE
stream when it sends `Accept: text/event-stream`. Both set `Vary: Accept`. The stream opens with a
`snapshot` event whose `catalog` equals the JSON body, then forwards `channel.*` events verbatim in
commit order, so none repeats the snapshot or follows its Channel's deletion, and sends `working`
only when the set changes. It has no cursor, so a reconnect opens a fresh snapshot that replaces the
client's catalog. Native clients hold one catalog stream while active instead of polling.

### Detail stream

`GET /api/v1/channels/:channelId` streams SSE through `subscribeToChannel`. Its snapshot carries a
`ChannelState` with the latest 100 public messages, roster, artifacts, routines, and the pending
request even outside that message window, and its durable facts come from one transaction. Reads
never acknowledge the Channel or expose private agent context. Artifacts carry their `id` and a
Files serving URL. Each attachment is `{ name, url, mimeType }` with a Files serving URL, and agent
tools map each one back to its absolute path.

The subscription establishes state and then delivers changes:

- No cursor: send `{ type: "snapshot", state }` with one complete `ChannelState`.
- `after` (including zero): replay contiguous durable events, then send `{ type: "resumed" }`. An
  unavailable replay becomes a replacement snapshot; clients discard older loaded history and can
  page it again.
- Live durable events forward directly; the subscription keeps only its revision and rereads
  nothing. Each read subscribes in its own continuation, with no I/O or timer between, so live
  events continue its revision.
- Deletion sends `{ type: "deleted", channelId }` and closes, including when the Channel is already
  absent on connection.

### Messages and reads

`GET /api/v1/channels/:channelId/messages?before=<sequence>` returns up to 100 older messages with
`{ revision, messages }` from one transaction.

`POST /api/v1/channels/:channelId/messages` accepts `{ id, content, attachments? }`, uses the normal
user-message schema and delivery policy, and returns HTTP 201 with the message. Attachments are
image uploads `{ mimeType, base64 }`. Retrying an ID the Channel already has returns its stored
message without delivering again, and an ID from another Channel returns 422.

`POST …/read` accepts `{ sequence }`, uses the same monotonic read operation as the browser, and
returns `{ seenThrough }`. Reading acknowledges completion but never answers a request. `PUT` and
`DELETE …/bookmarks/:sequence` bookmark and unbookmark a message idempotently and return 204;
bookmarking a system or missing message returns 422.

### Management

Native clients manage Channels through the same operations as the browser's channel menu, member
editor, mention completion, and routine actions:

- `POST /api/v1/channels` creates a Channel from `{ name, purpose?, directory?, model }` and starts
  its lead (201 with the Channel). `PATCH /api/v1/channels/:channelId` edits its name, purpose, or
  lead model and returns the Channel, and `DELETE` removes it (204).
- `POST …/members` creates a member from `{ name, role?, model? }` and starts its onboarding (201
  with the member). `PATCH …/members/:agentId` changes its name, role, or model (null inherits the
  workspace default), and `DELETE` removes it (204). Both reach only members of the routed Channel;
  the intrinsic lead is never one. Once a member's session exists, its provider is fixed: an
  explicit model from another provider returns 422. Clearing the override with `model: null` remains
  allowed: Sessions follows a compatible workspace default or keeps the session's provider, model,
  and history when that default belongs to another provider.
- `GET …/members/:agentId/models` returns `{ provider, models, defaultModel }` scoped like the
  browser's member editor: `provider` is the session's provider, else the configured model's, else
  null for no restriction. `defaultModel` is null when no compatible workspace default is
  available; it describes a model choice, not permission to clear an override.
- `POST …/routines/:routineId/run` wakes the lead with that routine now, and
  `DELETE …/routines/:routineId` removes it (204, or 404 when it is already gone).
- `DELETE …/artifacts/:artifactId` removes a shared artifact (204, or 404 when it is not shared).
  Clients percent-encode the id, since it contains `/` and `:`, for example
  `machine%3A%2Ftmp%2Fnotes.md`.
- `GET /api/v1/models`, which Providers owns, returns `{ models, defaultModel }`, the provider
  catalog and normalized workspace default that the browser's model pickers offer.

### Peers

`POST /api/v1/channels/:channelId/lead-messages` accepts `{ from, channelName, server, content }`
from another server's lead and answers 204 once this Channel's lead has accepted the message, not
once it replies.

### Errors

These routes answer like every [`/api/v1` route](../workspace/AGENTS.md#ownership-and-extension).
Bodies cannot name the identities in their route. A path ID that names no Channel, member, routine,
or artifact returns 404, and the Channel stream sends `deleted` instead. Domain refusals such as a
taken mention return 422 with the same message the browser shows. A failure can follow a committed
change, so clients refresh authoritative state rather than automatically retrying writes.

## Client data

The route loads the catalog before subscribing to workspace events. Live events reduce into that
cache, a [`reducedQuery`](../../shared/query.ts), with the pure transitions in `model/catalog.ts`,
so a read in flight replays the events applied meanwhile over the snapshot it returns. Reconnects
refresh the complete catalog. Create and edit responses refresh it rather than replay potentially
older rows over live updates. Message and read cursors are not catalog versions.

`useChannels()` composes the catalog and Session activity into entries with a Channel, its agents
and their `isWorking` flags, and a derived `status`: waiting for a reply, unread completion, or
unread messages. The sidebar and app SDK share this hook and its caches. Descriptive agent status
belongs to the detail stream. `channelAttention(channel, isOpen)` owns which marks an open Channel
hides: a request stays while it's open, and completion and unread messages clear. The sidebar and
palette both read it.

A visible pane subscribes to a `ChannelState` through one streamed Query: the first connection
supplies the snapshot, and later connections resume the cached revision. TanStack Query owns the
cached view, stream request, cancellation, and retries through `streamedQuery` with append
semantics. `stream.ts` adapts the public SSE endpoint into an async generator; each attempt reads
the latest cached revision, and unexpected EOF retries. Workspace deletion retires the detail query
and removes closed panes.

`reduceChannelState` applies the complete public protocol: messages derive metadata and attention,
quiet events replace tasks, model, and read state, and `resumed` leaves the state unchanged. The
separately retained pending request follows replies and reactions even outside the message window.

The browser's `ChannelQueryData` adds an arrival record to the state: a connection identity and the
unread boundary after its initial snapshot or post-replay `resumed` event. Replayed shared reads
therefore arrive before the browser captures that boundary, and paging, optimism, and later live
events cannot masquerade as arrival. A terminal deleted event leaves a null detail value.

The post mutation appends a pending message with its client-generated ID after the transcript,
leaving server cursors and attention alone, so the reducer takes only wire events. The committed
echo replaces that message and applies its authoritative position and metadata but keeps its
sender's local image URLs. A failed post removes its local copy unless the echo already replaced it.
History pages come from the public messages endpoint. The browser retries pages older than its
cached revision, merges already-materialized messages without replaying their events or advancing
the stream cursor, and pages through a target sequence to reveal a message, such as the pending
request or a bookmark.

`useChannel()` exposes the live state, its agents' presence, unread boundary, history paging, and
`postMessage` bound to that Channel. Posting supplies the message ID and invokes the shared
mutation; the composer owns only its draft and submission UI. The app SDK exports this same hook. A
visit defaults to `"active"`; visualizations use `mode: "passive"` to leave unread state untouched.

## Native push delivery

`server/push.ts` lazily publishes committed [request and completion](#attention-and-completion)
milestones; the three-second unread check runs only for subscribed topics. `channel:<id>` opens one
detail stream on first interest and closes it on last interest, retaining only metadata and roster
from its snapshot. A workspace listener publishes the catalog's waiting count after Channel upserts
and deletions, covering replies and removals without opening streams for every Channel. The same
listener republishes a topic from its retained state when a roster agent's Session activity changes,
and Push drops unchanged values. A followed topic does not resume from a cursor, so it stops
updating if its stream fails. Delivery belongs to [Push](../push/AGENTS.md). Channel payloads live
in `model/push.ts`, with four ChannelKit wire fixtures in `model/__fixtures__/push-*.apns`.

After the unread check, `model/notificationText.ts` builds alert text from the current Channel name,
the Mac's 400-grapheme plain-text request policy and attachment fallbacks, completion task-count
wording, the requester's handle, and a request's suggested replies. Replies are non-body data, so
long labels can shorten the alert body. Deletion publishes an end through the normal 100ms debounce
and dismisses at its push timestamp. Completion and removed-task endings retain their content for
fifteen minutes.

## Presentation

`ChannelPane` takes a Channel ID and owns one cached `ChannelState` for its transcript, overview,
and composer, plus the presence `useChannel` derives for its agents. It does not read the workspace
catalog. `ChannelPaneContext` shares one roster, presence, and the composer actions inside the
pane. The roster exists from the first render, starting from the intrinsic lead, so the composer,
transcript, and overview never derive their own.

The workspace deduplicates Channel panes by Channel ID, and panes and apps share one Query stream.
`subscribed` detaches hidden views, and Query cancels when the last observer leaves; cached content
and mounted drafts remain. On return, replay catches up that cache and establishes the unread
boundary before read acknowledgement or initial unread scrolling. A reader joining an existing
observer captures the current shared read cursor. A deleted event ends the subscription and reaches
the pane's unavailable boundary.

The sidebar, overview, and command palette offer the same Channel commands from `commands.tsx`, and
open one create/edit form, which shows the directory read-only.

The composer shell and its intrinsic "To Lead" audience render during SSR; hydration starts the
subscription, and the first snapshot populates the tray and roster and enables input. It shares
Sessions' composer shell and native `ComposerInput`, and agent mentions stay plain `@handle` text,
so delivery sees what the user typed. The draft is the Workspace saved draft `channel:<id>`, so it
survives reloads and follows the user across clients; reply and mention actions edit it through the
draft's verbs. `agentCompletionSource.ts` owns the whole mention policy: everyone, the lead,
matching members by name, and an offer to create an unknown handle, whose acceptance creates the
member and resolves to its mention. Its trigger is the model's `AGENT_MENTION_TRIGGER`, built from
the mention grammar delivery uses, so the menu completes exactly what delivery wakes.
`AgentCompletionMenu` supplies avatars and opens a member's editor, which outlives the menu, through
the `CompletionMenu` it shares with Sessions.

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
  optional divider precedes a row, labeling a new day, where unread messages begin, or both at once.
  `SystemMessageGroup` defines each kind's icon and presentation together; grouping and the durable
  message model stay separate.
  A pane-local view shows all messages or only the user's own, the agent messages that never
  collapse, and those the user bookmarked, so revealing a bookmark never changes the view. Rows form
  from the shown messages, so runs and dividers follow what the reader sees, and read state stays
  Channel-wide.
  `useTranscriptViewport` owns the virtualizer and where the reader looks: landing on the first
  unread row or the end, following the reader's own post, revealing a message on demand, and paging
  history. Paging continues while the first row, or an empty view, is in view, so a sparse view
  fetches pages instead of asking the server to filter. TanStack Virtual's mutable instance stays
  inside that hook, which the compiler skips.
  The unread divider comes from the read position on arrival and holds while it's read, so arrivals
  during reading are never marked. A flagged question is marked until a later user message
  acknowledges it. The activity row shows working agents; waiting shows in the overview, since a
  request already marks what the user needs to answer.
- The composer docks Sessions' [`ComposerTray`](../sessions/components/outputs/ComposerTray.tsx)
  for bookmarks and shared artifacts, newest first, plus the tasks and preview. URL previews show a
  sandboxed iframe on hover and open in a new tab. Screen previews show a passive live canvas and
  open or focus a Screen pane without opening a private agent Session or taking input control.
  Tray, overview, and historical preview messages share Workspace's preview presentation.
  While a request is pending, its `replies` appear as buttons inside the question's bubble; tapping
  one posts its label directly, with no draft. An "Input needed" button beside the composer's
  audience previews `state.request` on hover and, on click, loads any older pages needed and
  scrolls to the question. Both leave once the user replies.
- User and agent messages carry a bookmark toggle. While any bookmarks exist, a pill with their
  count leads the tray. Its list loads history through the oldest bookmark, and selecting one
  scrolls to its message the same way.
- The overview opens as a sheet or pins beside the transcript, which the workspace layout remembers.
  It shows the purpose, directory, and preview, then the team with its presence, the shared
  artifacts by when each was shared, the tasks, and any routines with their next run, prompt, and
  run and delete actions. Each artifact can be removed, and a waiting agent with a follow-up shows a
  bell and the minutes until it checks back, kept current by the clock that ages its tasks. Each
  section collapses independently, and its counts and task diff totals stay visible while collapsed.
  The Task list's count badge toggles an in-progress-only view, retaining and expanding every
  ancestor of an active task, and the Team members badge toggles working agents only. Filtering
  changes visibility only: count badges still describe their complete lists, and diff totals stay
  unfiltered.
- Both checklists share a task projection with stable identity and compact diff totals, with exact
  counts on hover and for assistive technology. The shared checklist owns filter visibility, the
  empty message its host supplies, and disclosure: a parent starts expanded only while a subtask at
  any depth is in progress, whatever its own status, and the rule reapplies when running work starts
  or stops beneath it. A running task shows `X / Y`, elapsed minutes over minutes until its
  check-in, then elapsed only once the check-in is consumed. Pending rows omit diff counts.
  Artifact references stay on their directly attributed tasks and never roll up, and open ordinary
  file panes without toggling the parent.
- Sidebar priority is waiting, unread completion, ordinary unread, then live lead or member
  activity; open Channels suppress completion like unread, but never suppress an unanswered request.
- The collapsed sidebar's rail lists each Channel that is waiting, has an unread completion, or has
  a working agent, by its avatar with that mark, and opens it without expanding the sidebar.
- Hovering a waiting Channel's row or rail avatar previews the catalog's pending request with its
  reply buttons, so the user can answer without opening it. Touch only opens the Channel.

## Invariants

- SQLite is authoritative. The server and Push reduce with the model's reducer and never retain a
  second live Channel aggregate.
- Browser and native clients share one public protocol, the catalog and detail streams and the
  `/api/v1/channels` routes, and browser RPC is a thin entry point to the same operations.
- Private work never enters the Channel. Agent transcripts, tool logs, and read positions stay in
  Sessions and Worker metadata, and the transcript holds only what was deliberately published.
- Wakes are best effort. Mentions, follow-ups, wake commands, routines, check-ins, and lead messages
  use ordinary Session delivery, with no durable outbox.
- Agent IDs are unique across the server. An agent's ID is its Session ID, so clients join presence,
  rosters, and activity by ID alone.

## Code map

- `model/` is the isomorphic domain. `index.ts` owns the types, input schemas, audience policy, and
  public exports. `tasks.ts` owns task identity, outcome schemas, derived diff totals, tree edits,
  ownership release, and completion. `agent.ts` owns agent names, roles, avatars, the lead profile,
  mention handles, resolving a tool's agent reference, and the deleted identity an ID resolves to
  once its agent is removed. `worker.ts` projects Worker metadata into the lead, members, and
  roster. `reducer.ts` reduces the complete public snapshot and owns the metadata and roster
  transitions shared with the server. `catalog.ts` reduces the browser catalog over workspace
  events. `presence.ts` and `reactions.ts` derive how agents and reactions display. `push.ts` and
  `notificationText.ts` own push payloads and alert text.
- `server/` owns authority. `schema.ts` and `database.ts` own tables and transactions. `index.ts`
  composes the algebra for RPC, tools, and wakes, and each verb takes its Channel and actor as
  parameters. `functions.ts` is browser RPC ingress, and `stream.ts` composes public views and owns
  subscriptions over `eventLog.ts`, each Channel's bounded event log. `attachments.ts` owns the files
  messages attach and the avatar image. `peers.ts` lists the Channels on the owner's peer servers
  and delivers a lead's message to one once, through Workspace's peers. `tools.ts` owns agent-facing
  projections and the Session, lead, and member tool sets, and translates the calling Session into
  its Channel and actor. Relative paths resolve against the directory in each handler's `ToolContext`,
  the one its provider runs in. `agent.ts` composes each agent's execution and
  instructions. `wakeCommands.ts` owns the wake command processes this server runs. `push.ts`
  publishes push milestones and followed topics, and `startup.ts` clears finished working statuses,
  starts the wake interval and push, and recovers and stops wake commands.
- `routes/v1/`, at the feature root where the route convention discovers it, answers
  `/api/v1/channels` requests in place.
- `queries.ts`, `stream.ts`, `mutations.ts`, `cache.ts`, `useChannels.ts`, and `useChannel.ts` own
  client data: the catalog's `reducedQuery` and the streamed detail queries, the SSE adapter,
  mutations, workspace event routing and history paging, the catalog's entries with activity, and
  one open Channel's visibility and read lifecycle. `panes.tsx` contributes the Channel pane, and
  `commands.tsx` defines a Channel's commands.
- `components/pane/` holds the pane, composer, and shared pane context, with `transcript/` and
  `overview/` beneath it. `components/agents/` holds avatars, mention Markdown, the mention source
  and menu, the member editor, and working agents. `components/sidebar/` holds the Channels panel,
  the rail, `status.ts`'s label for each sidebar state, and the request preview. `components/`'s top
  level holds the create/edit dialog, `ChannelAvatar`, and the request's reply buttons shared by the
  transcript and preview.
- Outside this folder, [Workers](../workers/AGENTS.md) owns agent identity and lifetime.
  [`sessionConfiguration.ts`](../../server/sessionConfiguration.ts) grants ordinary Sessions the
  Channel tools and resolves agent configuration, and
  [`managedSessions.ts`](../../server/managedSessions.ts) detaches a deleted agent's Session.
  [Workspace](../workspace/AGENTS.md) places the pane and sidebar panel and synchronizes
  `channel.*` events.

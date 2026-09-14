# Channels

Channels are durable, high-signal message buses for teams. A Channel is not a filtered SDK Session:
each member works in its own private Agent membership and learns about peers through the shared
transcript and artifact index.

## Domain model

- `Channel` owns a title, optional working directory, human read position, latest sequence, and updated
  time.
- `ChannelMessage` has a durable ID and transactionally allocated sequence. User and Agent messages
  have an immutable Markdown body with optional image attachments. Typed system messages record
  membership changes and artifact sharing. Browser uploads stay inline;
  trusted Session and Agent tools retain validated absolute paths. Agent senders retain only their
  stable Agent ID, so every surface resolves current identity or presents a generic deleted identity
  when none remains.
- `ChannelReaction` is one Agent's durable acknowledgement or sentiment on a user or Agent message.
  It is not another message or delivery event.
- `ChannelMember` projects an Agent-owned `AgentMembership` and adds that member's read position and
  optional brief public focus or waiting status. A working status may point to its prompting message
  as either general work or resource review; the transcript projects that link as a temporary
  activity reaction. The menu presents that current status; transcript activity
  presents only members whose private Sessions are currently working.
- `ChannelArtifact` gives a shared `WorkspaceFile` address and display title. Channels owns only its
  index; Files classifies an Agent-supplied absolute path so Session ownership survives, and
  Workspace toggles that same file as an ordinary root editor pane.

## Algebra

- Create, rename, list, read, and delete Channels; remove a member through its private Session.
- Let Standard, Hyper, Inbox, and Automation sessions list, create, passively read, post to, and
  share artifacts with Channels on the user's behalf.
- Let those Sessions wait for a Channel Agent's current execution without exposing its private
  Session or response; public results remain on the Channel.
- Append user, Agent, and system messages with a transactionally allocated sequence.
- Set or clear one Agent reaction per message without advancing message sequences or read positions.
- Set or clear one member's public status without moving the Channel list or waking teammates.
- Advance human and member read positions monotonically.
- Invite an Agent by mentioning it; another mention wakes an existing member.
- Create an Agent by selecting an unknown mention, then onboard it through that first Channel turn.
- Deliver user broadcasts and explicit mentions to current members, and admit new members.
- Let members read unseen messages, send useful public updates, and publish shared artifacts through
  Channel tools.
- Let an Agent working privately in a Session passively inspect joined Channels and hand work to its
  existing Channel membership, which retains ownership of read progress and public actions.
- Implement the Agent host contract by supplying Channel instructions, tools, and Channel-specific
  membership lifecycle.

## Delivery policy

- A user message mentioning current members wakes only those members. Mentioning an Agent outside the
  Channel admits it. The completion menu can create an unknown name before sending; freely typed
  unknown mentions remain public and wake nobody. A mentionless user message or `@everyone` wakes the
  current team.
- An Agent message wakes only explicitly mentioned members. Progress without mentions stays visible
  without creating an execution loop. Agent-authored mentions may admit Agents too.
- A `channel_message` system message steers a working member or starts an idle member. The private
  Session then calls `read_channel` to consume the durable bus and its attachments. File-backed
  images remain directly readable by path; inline browser uploads arrive as images.
- Starting an idle member clears only a prior waiting status. A working focus is never erased by the
  wake lifecycle and may be replaced explicitly by the Agent.
- Every public Agent update uses `send_channel_message`, which permits continued work and intermediate
  coordination. Screenshots and other images are message attachments, not shared artifacts.
  `react_to_channel_message` quietly sets or clears a reaction without waking anyone; terminal
  `finish_agent_turn` clears active status and therefore its projected activity reaction,
  optionally leaves a brief waiting status, and ends the work without publishing another message.
- Share an artifact only when a durable document or prototype is itself needed for team review or
  alignment, and prefer updating an existing canonical artifact. Channel messages use concise,
  scannable Markdown for decisions, questions, handoffs, and results rather than narration.

## Boundaries and invariants

Channels owns its model, schema, persistence, sequencing, delivery policy, tools, pane, and sidebar
panel. Agents owns identity, experiences, membership supervision, execution mode, and reusable UI.
Sessions owns private execution, activity, history, and worktrees. Workspace owns pane placement and
top-level composition.

Both user and Agent posts apply the same pure `resolveChannelAudience` plan used by the composer
preview, including broadcasts, invitations, unknown mentions, and sender exclusion. Explicit Agent
IDs are authoritative when supplied; otherwise ingress resolves name-derived mentions before
delivery.

Creating or removing a Channel member is the deliberate persistence seam: one transaction changes
the Agent-owned membership and Channel-owned read projection while appending its typed system
message.

- The database is authoritative. The Channel list query owns list-level metadata and the structural
  memberships used by the sidebar and composer. Workspace Channel events keep metadata and unread
  state current; membership hints refresh that projection, while shared Session activity drives live
  execution state. Each open Channel state owns its complete member projection, including brief
  Agent-authored status. Deletion prunes the open pane and closes its detail stream. Only a client
  displaying a Channel opens that ordered detail stream.
- Channel state records its revision, complete current membership and artifacts, and newest 100
  messages. Reaching the top prepends earlier messages into that same browser cache. Open panes
  reduce message appends plus reaction and status patches into the state; typed system messages also
  update current membership and artifacts. A replay gap falls back to one authoritative state event.
  `streamChannel` owns subscribe-before-state-read catch-up and live continuation, ordering
  concurrent publications and discarding duplicate revisions. The HTTP route maps revisions to SSE
  event IDs without introducing another domain position.
- The server does not reduce Channel events: mutations commit canonical database rows, then publish
  their transition. The reducer exists only to advance each browser's cached Channel state.
- Browser-authored message IDs reconcile optimistic user posts with their committed stream event.
  Per-Channel sequences remain the shared transcript order and the basis of human and Agent reads.
- Passive Session reads move backward by message sequence without changing read state. A Channel
  Agent reads forward from its durable `seenThrough` position and advances it.
- Shared messages, reactions, member status, and artifacts are the only peer communication contract.
  Private transcripts and tool logs never enter the bus.
- Agent-facing membership reads omit private Session IDs and read positions.
- Agent-facing artifact tools use absolute paths; the persisted Channel index retains Files-owned
  `WorkspaceFile` identity.
- A Channel requires neither a directory nor a worktree. Each new member independently chooses shared
  directory work or a Session-owned worktree through `initialExecutionMode` on its first mention.
- Removing a member or deleting a Channel tears down private Sessions through the shared Session
  lifecycle; the Channel host adapter is the single removal path.

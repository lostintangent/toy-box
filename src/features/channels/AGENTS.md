# Channels

Channels are durable, high-signal message buses for teams. A Channel is not a filtered SDK Session:
each member works in its own private Agent membership and learns about peers through the shared
transcript and artifact index.

## Domain model

- `Channel` owns a title, optional working directory, human read cursor, latest sequence, and updated
  time.
- `ChannelMessage` has a durable ID and transactionally allocated sequence, plus an immutable body
  with optional image attachments. Agent senders retain only their stable Agent ID, so every
  surface resolves current identity or presents a generic deleted identity when none remains.
- `ChannelReaction` is one Agent's current annotation on a user or Agent message, chosen from a
  small coordination palette. It is not another message or delivery event.
- `ChannelMember` projects an Agent-owned `AgentMembership` and adds only that member's unread cursor.
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
- Set or clear one Agent reaction per message without advancing message or read cursors.
- Advance human and member read cursors monotonically.
- Invite an Agent by mentioning it; another mention wakes an existing member.
- Create an Agent by selecting an unknown mention, then onboard it through that first Channel turn.
- Deliver user broadcasts and explicit mentions to current members, and admit new members.
- Let members read unseen messages, send useful public updates, and publish shared artifacts through
  Channel tools.
- Implement the Agent host contract by supplying Channel instructions and Channel-specific admission
  and removal.

## Delivery policy

- A user message mentioning current members wakes only those members. Mentioning an Agent outside the
  Channel admits it. The completion menu can create an unknown name before sending; freely typed
  unknown mentions remain public and wake nobody. A mentionless user message or `@everyone` wakes the
  current team.
- An Agent message wakes only explicitly mentioned members. Progress without mentions stays visible
  without creating an execution loop. Agent-authored mentions may admit Agents too.
- A `channel_message` system message steers a working member or starts an idle member. The private Session then calls
  `read_channel` to consume the durable bus and any user-attached images.
- Every public Agent update uses `send_channel_message`, which permits continued work and intermediate
  coordination. It may copy image files into that immutable message without registering them as
  artifacts. `react_to_channel_message` quietly sets or clears a reaction without waking anyone;
  terminal `finish_agent_turn` ends the work without publishing another message.
- Evolving work such as specs, plans, designs, and evaluations belongs in an early canonical shared
  artifact. Channel messages stay concise and conversational, carrying decisions, questions, and
  handoffs rather than successive document revisions.

## Boundaries and invariants

Channels owns its model, schema, persistence, sequencing, delivery policy, tools, pane, and sidebar
panel. Agents owns identity, experiences, membership supervision, execution mode, and reusable UI.
Sessions owns private execution, activity, history, and worktrees. Workspace owns pane placement and
top-level composition.

Both user and Agent posts apply the same pure `resolveChannelAudience` plan used by the composer
preview, including broadcasts, invitations, unknown mentions, and sender exclusion. Explicit Agent
IDs are authoritative when supplied; otherwise ingress resolves name-derived mentions before
delivery.

Creating a Channel member is the deliberate persistence seam: one transaction creates the
Agent-owned membership and its Channel-owned cursor projection.

- The database is authoritative. The Channel list is the browser's sole owner of Channel metadata;
  workspace `channel.upserted` and `channel.deleted` events keep that list and its unread projection
  current for every client. Deletion prunes the open pane and closes its detail stream. Only a client
  displaying a Channel opens that ordered detail stream.
- A detail snapshot records its event cursor. Open panes reduce incremental message, reaction,
  membership, and artifact events into that snapshot; a replay gap falls back to one authoritative
  snapshot. `streamChannel` owns subscribe-before-snapshot catch-up and live continuation, ordering
  concurrent publications and discarding duplicate cursors; the HTTP route only adapts that
  capability to SSE.
- The server does not reduce Channel events: mutations commit canonical database rows, then publish
  their transition. The reducer exists only to advance each browser's cached snapshot.
- Browser-authored message IDs reconcile optimistic user posts with their committed stream event.
  Per-Channel sequences remain the shared transcript order and the basis of human and Agent reads.
- Session reads use an explicit message sequence and never advance human or member read cursors.
- Shared messages, reactions, and artifacts are the only peer communication contract. Private
  transcripts and tool logs never enter the bus.
- Agent-facing roster reads omit private Session IDs and cursors.
- Agent-facing artifact tools use absolute paths; the persisted Channel index retains Files-owned
  `WorkspaceFile` identity.
- A Channel requires neither a directory nor a worktree. Each new member independently chooses shared
  directory work or a Session-owned worktree through `initialExecutionMode` on its first mention.
- Removing a member or deleting a Channel tears down private Sessions through the shared Session
  lifecycle; the Channel host adapter is the single removal path.

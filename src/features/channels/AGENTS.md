# Channels

Channels are durable shared collaboration spaces for the user, an intrinsic lead, and
channel-specific members. A Channel is not a filtered Session. The lead and every member are durable
Channel-owned Workers with private Sessions, while the Channel transcript is the complete public
coordination surface.

## Domain model

- `Channel` owns its name, optional purpose and working directory, lead model and Worker ID, public
  checklist, optional preview URL, human read position, latest message sequence, and updated time.
- `ChannelLead` is the fixed public identity of the intrinsic lead. Its model belongs to the Channel.
  Its read position and status live in the lead Worker metadata. The lead is not a member and never
  produces membership messages.
- `ChannelMember` is the current public projection of one Channel-owned Worker. The Worker ID is also
  its private Session ID and public Agent ID. The projection contains its name, optional role,
  model, avatar, and collaboration status. Its read position stays private in Worker metadata.
- `ChannelMessage` has a durable ID and transactionally allocated sequence. User and Agent messages
  contain Markdown and optional image attachments. Typed system messages record membership and
  artifact changes. Agent senders retain only their stable Worker ID, so deleting a member preserves
  prior content while the UI presents a deleted identity.
- `ChannelReaction` is one Agent's durable acknowledgement or sentiment on a user or Agent message.
  It does not wake anyone or advance message sequence.
- `ChannelArtifact` indexes a shared `WorkspaceFile` and title. Files owns the address and editor.
  Channels owns only the shared index and transcript event.
- `ChannelState` is the authoritative current lead, member roster, and artifacts plus a bounded
  message window and detail revision. Earlier messages page by sequence.

There is no separate Agent or membership database. Workers persists ownership, name, and opaque
metadata. Channels validates that metadata as role, model, avatar, `seenThrough`, and status, then
projects it into the fixed lead or an editable `ChannelMember`.

## Algebra

- Create a Channel and its lead together, then immediately start the lead. With a purpose, the lead
  frames the current work and begins. Without one, the lead asks the user what they want to work on.
- Rename, list, read, and delete Channels.
- Create, edit, start, finish, and remove Channel members through their owned Workers.
- Append user, Agent, and typed system messages with one transactionally allocated sequence.
- Route every message through one pure `resolveChannelAudience` policy. An unmentioned user or member
  message wakes the lead. An unmentioned lead message wakes nobody. Explicit name-derived mentions
  wake exactly those agents, while `@everyone` wakes the lead and all members except the sender.
- Set or clear one reaction per Agent without advancing transcript state.
- Set or clear one member status without moving the Channel list or waking peers.
- Advance human and Agent read positions monotonically.
- Register durable artifacts once and surface later file edits automatically. Attach screenshots or
  other images to messages.
- Let the lead set or revise the purpose and replace the public checklist or preview URL without
  creating transcript noise, unread state, or list movement.
- Let ordinary Sessions create and staff Channels, then read, post, share, and wait for the lead or
  members on the user's behalf. Let the lead create peers within its own Channel.

Selecting an unknown mention creates a member in that Channel. Mentioning any current member lazily
starts or steers its private Worker Session. Removing the member deletes that Session and Worker.
Members never exist outside their Channel and cannot be invited from a global pool. The intrinsic
lead exists for the Channel's lifetime and is addressed as `@lead`.

## Agent execution

`server/agent.ts` composes current Channel identity, purpose, collaboration instructions, model policy,
and tools whenever a private Session starts an execution. The lead can inspect the same model catalog
as the client before creating peers. Member profile changes apply between executions without mutating
provider history. The lead receives its fixed identity and responsibilities from the Channel rather
than editable Worker metadata. Among Channel agents, it alone creates members and updates the public
purpose, checklist, and preview.

The collaboration protocol asks an agent to read current context at turn start, use the smallest
useful public action, set status only for substantive work, reread before a result or handoff, mention
members whose wait it fulfills, and finish every turn explicitly. Public messages, reactions,
statuses, artifacts, and attachments are the only peer communication contract. Private transcripts
and tool logs never enter the Channel. Model-facing message tools cap posts at 3,000 characters so
durable long-form work stays in canonical shared artifacts; browser messages retain the Channel
model's 12,000-character limit.

The built-in lead role establishes the purpose with the user when needed, scales planning to the
work, keeps a lightweight current checklist, creates each member only when their work is actionable,
drives quality through review and iteration, and keeps the public progress surfaces current.
Delegation never transfers accountability for the purpose or the quality of a member's outcome.

A turn start clears only a prior waiting status. `finish_agent_turn` clears active status and its
projected activity reaction, or leaves a concise waiting status, then closes the turn.

## Persistence and streaming

Channels owns its schema, database operations, sequence allocation, delivery policy, tools, pane, and
sidebar panel. Workers owns managed Session identity and lifetime. Sessions owns execution, history,
streaming, completion, and worktrees. Workspace owns pane placement and cross-feature synchronization.

Creating a Channel inserts its row and reserved lead Worker in one transaction. Creating or removing
a member is one transaction that changes the Worker record and appends the typed system message.
Removing a member also clears that member from checklist ownership. Profile and status changes update
Worker metadata and advance the Channel revision. Purpose, checklist, and preview changes update Channel
metadata through the existing workspace upsert without advancing transcript sequence or revision.
Read-position changes update only Worker metadata. Message, reaction, and artifact tables continue
to reference the stable Agent ID without a foreign key so authored history survives member removal.

The database is authoritative. The list query returns Channel metadata plus current members for the
sidebar, composer, and overview sheet. The fixed lead identity is derived from the Channel's lead ID.
A visible pane suspense-loads current `ChannelState`, then reduces ordered SSE events into that query
cache. The server commits canonical rows and publishes transitions but never reduces events.

Message sequence is transcript order and the basis of paging and read positions. Revision is detail
state order and also advances for reactions, profile changes, and statuses. A bounded replay ring
resumes SSE by revision; a gap emits one authoritative `state` event. The client keeps earlier paged
messages when that recovery state remains contiguous.

Agent reads move forward from private `seenThrough` and advance it. Passive Session reads page
backward without changing read state. Agent-facing projections expose exact mentions, roles, and
statuses but never private Session IDs as a separate concept or another member's read position.

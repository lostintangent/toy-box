# Channels

Channels are durable shared collaboration spaces for the user and channel-specific Agents. A Channel
is not a filtered Session. Each Agent is a durable Channel-owned Worker with its own private Session,
while the Channel transcript is the complete public coordination surface.

## Domain model

- `Channel` owns its title, optional working directory, human read position, latest message sequence,
  and updated time.
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
- `ChannelState` is the authoritative current roster and artifacts plus a bounded message window and
  detail revision. Earlier messages page by sequence.

There is no separate Agent or membership database. Workers persists ownership, name, and opaque
metadata. Channels validates that metadata as role, model, avatar, `seenThrough`, and status, then
projects it into `ChannelMember`.

## Algebra

- Create, rename, list, read, and delete Channels.
- Create, edit, start, finish, and remove Channel members through their owned Workers.
- Append user, Agent, and typed system messages with one transactionally allocated sequence.
- Route user broadcasts and explicit name-derived mentions through one pure
  `resolveChannelAudience` policy. Agent messages wake only explicitly mentioned peers.
- Set or clear one reaction per Agent without advancing transcript state.
- Set or clear one member status without moving the Channel list or waking peers.
- Advance human and Agent read positions monotonically.
- Share durable artifacts and attach screenshots or other images to messages.
- Let ordinary Sessions create and staff Channels, then read, post, share, and wait on the user's
  behalf. Let Channel Agents create peers within their own Channel.

Selecting an unknown mention creates an Agent in that Channel. Mentioning any current Agent lazily
starts or steers its private Worker Session. Removing the Agent deletes that Session and Worker.
Agents never exist outside their Channel and cannot be invited from a global pool.

## Agent execution

`server/agent.ts` composes current Channel identity, collaboration instructions, model policy, and
tools whenever the private Session starts an execution. Agents can inspect the same model catalog as
the client before creating peers. Profile changes therefore apply between executions without
mutating provider history.

The collaboration protocol asks an Agent to read current context at turn start, use the smallest
useful public action, set status only for substantive work, reread before a result or handoff, mention
members whose wait it fulfills, and finish every turn explicitly. Public messages, reactions,
statuses, artifacts, and attachments are the only peer communication contract. Private transcripts
and tool logs never enter the Channel.

A turn start clears only a prior waiting status. `finish_agent_turn` clears active status and its
projected activity reaction, or leaves a concise waiting status, then closes the turn.

## Persistence and streaming

Channels owns its schema, database operations, sequence allocation, delivery policy, tools, pane, and
sidebar panel. Workers owns managed Session identity and lifetime. Sessions owns execution, history,
streaming, completion, and worktrees. Workspace owns pane placement and cross-feature synchronization.

Creating or removing a member is one transaction that changes the Worker record and appends the typed
system message. Profile and status changes update Worker metadata and advance the Channel revision.
Read-position changes update only Worker metadata. Message, reaction, and artifact tables continue to
reference the stable Agent ID without a foreign key so authored history survives removal.

The database is authoritative. The list query returns Channel metadata plus current members for the
sidebar and composer. A visible pane suspense-loads current `ChannelState`, then reduces ordered SSE
events into that query cache. The server commits canonical rows and publishes transitions but never
reduces events.

Message sequence is transcript order and the basis of paging and read positions. Revision is detail
state order and also advances for reactions, profile changes, and statuses. A bounded replay ring
resumes SSE by revision; a gap emits one authoritative `state` event. The client keeps earlier paged
messages when that recovery state remains contiguous.

Agent reads move forward from private `seenThrough` and advance it. Passive Session reads page
backward without changing read state. Agent-facing projections expose exact mentions, roles, and
statuses but never private Session IDs as a separate concept or another member's read position.

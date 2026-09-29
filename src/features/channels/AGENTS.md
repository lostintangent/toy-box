# Channels

Channels are durable shared collaboration spaces for the user, an intrinsic lead, and
channel-specific members. A Channel is not a filtered Session. The lead and every member are durable
Channel-owned Workers with private Sessions, while the Channel transcript is the complete public
coordination surface.

## Domain model

- `Channel` owns its name, optional purpose and working directory, lead model, public
  checklist, optional preview URL, human read position, latest message sequence, and updated time.
  Its catalog also derives `hasUnreadCompletion` and `hasPendingRequest` from the durable transcript.
  These are independent attention facts, not stored lifecycle states.
- `ChannelLead` is the fixed public identity of the intrinsic lead. Its Worker and Session ID is the
  Channel ID. Its model belongs to the Channel.
  Its read position and status live in the lead Worker metadata. The lead is not a member and never
  produces membership messages.
- `ChannelMember` is the current public projection of one Channel-owned Worker. The Worker ID is also
  its private Session ID and public Agent ID. The projection contains its name, optional role,
  model, avatar, and collaboration status. Its read position stays private in Worker metadata.
- `ChannelMessage` has a durable ID and transactionally allocated sequence. User and Agent messages
  contain Markdown and optional image attachments. Typed system messages record name, purpose,
  directory, membership, and artifact changes. Agent senders retain only their stable Worker ID, so deleting
  a member preserves prior content while the UI presents a deleted identity.
  `channel_marked_done` records completion. `user_attention_requested` references an agent's
  request message by `requestSequence`; intervening posts never change that association.
- `ChannelReaction` is one Agent's durable acknowledgement or sentiment on a user or Agent message.
  It does not wake anyone or advance message sequence.
- `ChannelArtifact` indexes a shared `WorkspaceFile`, its title, and when it was first shared; sharing
  it again changes only the title. Files owns the address and editor. Channels owns only the shared
  index and the `artifact_shared` transcript event, whose own timestamp records the share.
- `ChannelState` is the authoritative current lead, member roster, and artifacts plus a bounded
  message window and detail revision. Earlier messages page by sequence.

There is no separate Agent or membership database. Workers persists ownership, name, and opaque
metadata. Channels validates that metadata as role, model, avatar, `seenThrough`, and status, then
projects it into the fixed lead or an editable `ChannelMember`. `model/worker.ts` owns these pure
projections for persistence and runtime configuration; private read positions stay out of public members.

## Algebra

- Create a Channel and its lead together, then immediately start the lead. With a purpose, the lead
  frames the current work and begins. Without one, the lead asks the user what they want to work on.
- Edit a Channel's name, purpose, and lead model; list, read, and delete Channels. The sidebar and
  overview offer the same channel menu and open the same create/edit form. Only the lead can change
  the Channel's working directory through its `update_channel` tool; the form shows it read-only.
  Existing private Sessions keep their provider and history. Model and directory changes take effect
  at each agent's next execution, not during active work.
- Create, edit, start, finish, and remove Channel members through their owned Workers.
- Append user, Agent, and typed system messages with one transactionally allocated sequence.
- Route every message through one pure `resolveChannelAudience` policy. An unmentioned user or member
  message wakes the lead. An unmentioned lead message wakes nobody. Explicit name-derived mentions
  wake exactly those agents, while `@everyone` wakes the lead and all members except the sender.
  The composer resolves the same policy for its draft, so it shows exactly who a message will wake.
- Set or clear one reaction per Agent without advancing transcript state.
- Set or clear one member status without moving the Channel list or waking peers.
- Advance human and Agent read positions monotonically.
- Let only the lead mark the current goal done or flag an already-posted user request. Both append
  typed system messages through the normal detail stream, without ending the lead's turn. Completion
  requires every retained checklist item and descendant done and no current member waiting.
  Rejected completion checks report the exact blockers without changing anything.
  Reading a completion message acknowledges its sidebar indication. Reading a request does not:
  any later committed user message acknowledges it and also reaches the lead, preserving any
  explicitly mentioned recipients. A reply between the request post and its registration counts.
  Acknowledgement does not imply that the user's response resolves the request.
- Register durable artifacts once and surface later file edits automatically. Attach screenshots or
  other images to messages.
- Let only the lead among Channel agents rename the Channel, revise its purpose, or change its
  working directory. Name, purpose, and directory changes create a durable system message;
  checklist and preview updates alone do not create transcript noise, unread state, or list movement.
- Let ordinary Sessions create and staff Channels, then read, post, share, and wait for the lead or
  members on the user's behalf. Let the lead create peers within its own Channel.

Selecting an unknown mention creates a member in that Channel and immediately starts its private
Worker Session for onboarding. The member reads context and establishes missing profile details, then
works on any assignment already received or finishes quietly. Idle membership is not a waiting status.
Mentioning a current member delivers instructions through the ordinary Session mailbox. Removing the member deletes that Session and Worker.
Members never exist outside their Channel and cannot be invited from a global pool. The intrinsic
lead exists for the Channel's lifetime and is addressed as `@lead`.

## Agent execution

`server/agent.ts` composes current Channel identity, purpose, working directory, collaboration
instructions, explicit model, and tools whenever a private Session starts an execution. Application
configuration composition resolves workspace model defaults while preserving an existing provider.
Sessions owns directory fallback and applying configuration between executions. The lead can
inspect the same model catalog as the client before creating peers. Member profile and Channel
directory changes apply between executions without mutating provider history. The lead receives its
fixed identity and responsibilities from the Channel rather than editable Worker metadata. Among
Channel agents, it alone creates members and updates the directory, public purpose, checklist, and
preview.

A directory is optional. Channels records a provided directory without creating it. When the work
needs one and none was provided, the lead can create and assign it through `update_channel`.

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
During working communication, the lead posts what it needs from the user normally, then calls
`request_user_attention` with the returned sequence. During finite completion, it posts its result
normally, then calls `mark_channel_done`. Neither operation accepts message text or replaces
`send_channel_message` or `finish_agent_turn`.

A turn start clears only a prior waiting status. `finish_agent_turn` clears active status and its
projected activity reaction, or leaves a concise waiting status, then closes the turn.

## Persistence and streaming

Channels owns its schema, database operations, sequence allocation, delivery policy, tools, pane, and
sidebar panel. Workers owns managed Session identity and lifetime. Sessions owns execution, history,
streaming, completion, and worktrees. Workspace owns pane placement and cross-feature synchronization.

Channels spawns the lead and members through Workers with durable retention. Its admission callback
commits the Channel and lead together, or a member and its membership message together, before
execution begins, and returns the committed Channel or member through the Worker receipt. Removing a
member transactionally changes the Worker record and appends its typed system message.
Removing a member also clears that member from checklist ownership. Profile and status changes update
Worker metadata and advance the Channel revision. Name, purpose, and directory changes update
Channel metadata and append a separate typed system message for each changed property in one
transaction, advancing sequence and revision for each; a user purpose change also wakes the lead
to read the new direction. Lead-model changes
update metadata without a message. Checklist and preview-only changes update metadata through the
workspace upsert without advancing sequence or revision.
Read-position changes update only Worker metadata. Message, reaction, and artifact tables continue
to reference the stable Agent ID without a foreign key so authored history survives member removal.

The database is authoritative. Lead metadata updates and attention operations authorize against the
Channel's intrinsic lead ID within their transaction. The list query returns metadata and members for the
sidebar, composer, and overview sheet. The fixed lead identity is derived from the Channel ID.
A visible pane suspense-loads current `ChannelState`, then reduces ordered SSE events into that query
cache. The server commits canonical rows and publishes transitions but never reduces events.
The same catalog projection supplies list snapshots and existing `channel.upserted` events for
messages, reads, and metadata edits. Attention needs no additional workspace event or detail state.
The route loads the catalog before subscribing to workspace events. Live events patch that cache;
an event overlapping a refetch triggers TanStack's native replacement refetch. Reconnects refresh
the complete catalog. Create/edit responses invalidate it rather than replay potentially older
rows over live updates. Message and read cursors are not catalog versions.

Message sequence is transcript order and the basis of paging and read positions. Revision is detail
state order and also advances for reactions, profile changes, and statuses. A bounded replay ring
resumes SSE by revision; a gap emits one authoritative `state` event. The client keeps earlier paged
messages when that recovery state remains contiguous.

Agent reads move forward from private `seenThrough` and advance it. Passive Session reads page
backward without changing read state. Agent-facing projections expose exact mentions, roles, and
statuses but never private Session IDs as a separate concept or another member's read position.

## Presentation

`ChannelPane` renders the composer from the catalog, so a draft can begin before the Channel's state
arrives, and suspends the transcript and overview on `ChannelState`. Those two share the roster and
the composer's reply and mention actions through `ChannelPaneContext`.

- The transcript's rows come from `transcriptRows`: each user message stands alone, one agent's
  consecutive messages form a run, and matching system messages merge. Day dividers and a "New" rule
  fall between rows. The "New" position follows the read position while the Channel is out of view
  and holds while it's read, so arrivals during reading are never marked. A request marks the message
  it references until a later user message acknowledges it, by the catalog's rule. The activity row
  shows working agents; waiting shows in the overview, since a request already marks what the user
  needs to answer.
- The composer docks the session composer's tray for shared artifacts, newest first, plus the
  checklist and preview. While the catalog reports a pending request, including one outside the
  loaded window, it asks for a reply.
- The overview opens as a sheet or pins beside the transcript, which the workspace layout remembers.
  It shows the purpose, directory, and preview, then the agents with their presence, the shared
  artifacts with when each was shared, and the checklist.
- Sidebar priority is waiting, unread completion, ordinary unread, then live lead/member activity;
  open channels suppress completion like unread, but never suppress an unanswered request.

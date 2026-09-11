# Agents

Agents owns durable teammates. An Agent carries a portable identity across projects; an
`AgentMembership` gives that teammate a private Session inside one host. Sessions, Channels, and
Files compose this capability without gaining a second execution model.

## Domain model

- `Agent` starts with a globally unique name and may receive an initial persona. Its first host
  engagement establishes any missing persona and its self-authored avatar; it may also inherit or
  later receive an optional Session model. Its plain-text mention handle is derived from its name,
  not a second identity. The persona is the single standing description of who the teammate is and
  how it works.
- `AgentAvatar` is an Agent-authored SVG path and color rendered inside trusted UI-owned markup.
  The open-ended mark provides personality without executable SVG, remote content, or an asset
  lifecycle.
- `AgentExperience` is one distilled, cross-project preference, workflow, collaboration lesson, or
  heuristic acquired by the Agent. Users may review, edit, or delete it; project facts belong in
  project documentation, AGENTS.md, or a project skill.
- `AgentMembership` is one Agent's durable presence in one Session, Channel, or file. It owns exactly
  one private Session and a `shared | worktree` execution mode. It retains only the stable Agent ID;
  consumers resolve current identity from `Agent`. Running, waiting, and idle state come from that
  Session; turn-specific requests remain in its prompt or host message bus.
- `AgentMention` is the transient request carried by a user message. It identifies an Agent and the
  optional initial execution mode. Addressing uses stable Agent IDs; mentioning the same Agent again reuses and wakes its membership without changing that mode.
- `AgentHost.kind` identifies the Session, Channel, or file that owns public context. Its host
  adapter supplies membership instructions and any host-specific admission or removal. Public
  messages and files remain owned by their respective hosts, including publication tools.

## Algebra

- Create a named Agent with an optional initial persona through a user-directed Session or by
  selecting an unknown mention; update, list, and delete Agents.
- Onboard a new Agent within its first ordinary host engagement, where it establishes any missing
  persona and its avatar before finishing.
- Let an Agent add, update, and delete its experiences; let the user review, edit, or delete them.
- Resolve name-derived `@handle` text into Agent mentions; Channels alone gives `@everyone`
  broadcast meaning.
- Admit a mention as a new membership or wake the existing membership.
- Mention an Agent through one admission, wake, and missing-history recovery path for every host.
- Remove a membership when its private Session is deleted.
- Let an Agent update its own persona or avatar and retain a durable experience when work reveals one.
- Let a Session-hosted Agent inspect Channels it belongs to and hand operational work to its existing
  Channel membership, preserving that membership's private context and public attribution.
  Terminal host replies or `finish_agent_turn` end private work through normal Session completion,
  without a completion handshake or identity gate.

`update_agent` owns persona and avatar changes. `manage_agent_experience` owns experience collection
changes, with exactly one add, update, or delete action per call. This keeps experience identity and
mutation out of a generic patch shape.

## Boundaries

Agents owns its model, schema, persistence, queries and mutations, membership supervision, runtime
instructions, tools, and reusable UI. Sessions owns SDK execution, history, streams, activity,
system messages, worktrees, and transcript presentation. Sessions, Channels, and Files implement the
narrow Agent host contract. Workspace only composes Agent events and navigation.

An Agent membership directly owns its private Session. It is not a Worker: Workers are anonymous work
spawned and supervised by a parent Session, while Agents are named teammates admitted to hosts by
mention. Both reuse the Session runtime.

## Invariants

- Private transcripts are working state. Other Agents see only public host messages, explicit
  artifacts, and the host briefing.
- Cross-host Channel work runs through the Agent's existing Channel membership. A Session membership
  may read joined Channels passively, but it neither adopts their cursors nor publishes as them.
- Agent experiences are portable and reviewable. Repository facts and project conventions are not
  experiences.
- Agent configuration is refreshed before each idle turn, so persona, avatar, experience, and model
  changes apply without interrupting active work.
- A new Agent establishes any missing persona and its avatar during its first engagement. Afterwards,
  identity changes should reflect durable evolution, not routine task progress.
- Experiences contain durable cross-project lessons; revise an overlapping experience rather than
  adding another.
- Worktrees are optional and created by Sessions before model work begins.
- Managed Agent sessions do not appear in the ordinary session list. Hosts may show their passive
  Session preview as activity detail.
- A regular Session renders a published Agent response with Agent attribution when one is useful. A
  Channel Agent speaks through Channel tools, and a file Agent works directly in the file; every host
  permits silent completion when a mention needs no action.
- Another mention resumes an idle private Session or recreates its missing runtime from durable
  membership state; Agents has no parallel status or retry lifecycle.
- Deleting an Agent or its host tears down owned private Sessions through the shared Session lifecycle,
  whose host removal operation removes the membership projection.
- Hosts supply the message and workspace context to `mentionAgent`. The Channel host adapter supplies
  its atomic membership-and-cursor admission; it does not coordinate private Session startup or
  recovery.

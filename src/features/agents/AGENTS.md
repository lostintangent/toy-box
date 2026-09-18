# Agents

Agents owns durable teammates for Channels. An `AgentMembership` gives one Agent a private Session
inside a Channel, reusing the ordinary Session runtime for execution and history.

## Domain model

- `Agent` starts with a globally unique name and may receive an initial persona. Its first host
  engagement establishes any missing persona and its self-authored avatar. It may also receive an
  optional model for private hosted Sessions. Its plain-text mention handle is derived from its name,
  not a second identity. The persona is the single standing description of who the teammate is and
  how it works.
- `AgentAvatar` is an Agent-authored SVG path and color rendered inside trusted UI-owned markup.
  The open-ended mark provides personality without executable SVG, remote content, or an asset
  lifecycle.
- `AgentExperience` is one distilled, cross-project preference, workflow, collaboration lesson, or
  heuristic acquired by the Agent. Users may review, edit, or delete it; project facts belong in
  project documentation, AGENTS.md, or a project skill.
- `AgentMembership` is one Agent's durable presence in one Channel. It owns exactly one
  private Session and retains only the stable Agent ID. Consumers resolve current identity from
  `Agent`. Running, waiting, and idle state come from that Session. Turn-specific requests remain in
  its prompt or host message bus.
- Visible name-derived `@handle` text in a Channel admits or wakes the Agent's membership.
- `AgentHost` identifies the Channel that owns public context. Its host
  adapter supplies membership instructions, Agent tools, and any host-specific admission, removal,
  or turn settlement. Public messages and files remain owned by their respective hosts, including
  publication tools.

## Algebra

- Create a named Agent with an optional initial persona through a user-directed Session or by
  selecting an unknown Channel mention; update, list, and delete Agents.
- Onboard a new Agent during its first hosted turn, where it establishes any missing
  persona and its avatar before finishing.
- Let an Agent add, update, and delete its experiences; let the user review, edit, or delete them.
- Resolve name-derived `@handle` text into Channel mentions, including `@everyone` broadcasts.
- Admit a Channel mention as a new membership or wake the existing membership.
- Let a host settle its public membership state when a private turn starts and when that exact
  Session execution finishes.
- Remove a membership when its private Session is deleted.
- Let an Agent update its own persona or avatar and retain a durable experience when work reveals one.
- Let terminal host replies or `finish_agent_turn` end private work through normal Session
  completion, without a completion handshake or identity gate.

`update_agent` owns persona and avatar changes. `manage_agent_experience` owns experience collection
changes, with exactly one add, update, or delete action per call. This keeps experience identity and
mutation out of a generic patch shape.

## Boundaries

Agents owns its model, schema, persistence, queries and mutations, membership supervision, runtime
instructions, tools, and reusable UI. Sessions owns provider execution, history, streams, activity,
worktrees, and transcript presentation. Channels implements the narrow Agent host contract.
Application composition configures private Channel Agent Sessions. Workspace only composes Agent
events and navigation.

An Agent membership directly owns its private Session. It is not a Worker: Workers are anonymous work
spawned and supervised by a parent Session, while Agents are named teammates admitted to hosts by
mention. Both reuse the Session runtime.

## Invariants

- Private transcripts are working state. Other Agents see only public host messages, explicit
  artifacts, and the host briefing.
- Agent experiences are portable and reviewable. Repository facts and project conventions are not
  experiences.
- Agent configuration is refreshed before each idle turn, so identity and experience changes apply
  without interrupting active work. Private hosted Sessions also refresh the Agent's model.
- A new Agent establishes any missing persona and its avatar during its first engagement. Afterwards,
  identity changes should reflect durable evolution, not routine task progress.
- Experiences contain durable cross-project lessons; revise an overlapping experience rather than
  adding another.
- Private Agent Sessions use their Channel's working directory.
- Managed Agent sessions do not appear in the ordinary session list. Hosts may show their passive
  Session preview as activity detail.
- A Channel Agent speaks through Channel tools. Hosted turns permit silent completion when a mention
  needs no action.
- Another Channel mention resumes an idle private Session or recreates its missing runtime from
  durable membership state. Agents has no parallel status or retry lifecycle.
- Deleting an Agent or its host tears down owned private Sessions through the shared Session lifecycle,
  whose host removal operation removes the membership projection.
- Hosts supply the message and workspace context to `mentionAgent`. The Channel host adapter supplies
  its atomic membership-and-read-position admission; it does not coordinate private Session startup or
  recovery.

# Copilot SDK Boundary

This subsystem gives the rest of Toy Box one stable semantic language even when the Copilot SDK's events, tools, and persistence have different shapes. Outbound operations configure SDK sessions, prompts, attachments, models, instructions, and tools. Inbound projection converts SDK-specific activity into canonical `SessionEvent`s that the runtime, reducer, history replay, and UI all understand. SDK mechanics stop here; application lifecycle remains owned by the session registry and runtime.

## One event model

Raw SDK events are not the application contract. One stateful projector per session owns all translation policy:

- SDK tool aliases become one canonical tool vocabulary.
- Tools can remain visible, be omitted, translate into semantic events, augment their visible lifecycle, or defer completion until a later SDK event.
- Tool start, progress, completion, subagent activity, todos, artifacts, canvases, model changes, status, reasoning, and messages become canonical `SessionEvent`s.
- SDK session lifecycle signals and title changes are read separately because they control runtime completion and session-list metadata; assistant turn events remain inside projection.

Live and persisted activity deliberately share that policy:

```text
live SDK callback ───────────────┐
                                ├─> session projector ─> SessionEvent ─> session reducer
persisted SDK history ─> replay ┘
```

History replay creates a fresh projector, feeds the stored SDK events in order, and applies the same reducer used by the live stream and browser. It adds only the synthetic idle ending needed to clear transient streaming state. There is no second history interpretation path.

[`../../model/reducer.ts`](../../model/reducer.ts) is SDK-agnostic. It returns immutable session states with structural sharing, allowing React consumers to rerender only changed messages or tool calls. Translation policy belongs in the projector; transcript state transitions belong in the reducer.

## Session process and handles

`client.ts` owns one process-wide `CopilotClient`, started during server boot or by the first operation that reaches it. It creates, resumes, lists, and deletes SDK sessions, exposes models, discovers skills for a meaningful working directory or host scope, and normalizes persisted working-directory context. Bun development resolves the installed platform package's native Copilot CLI; a compiled Toy Box binary resolves the globally installed executable.

Composer skills are server-wide discovery data, not session transcript state. The client caches them by effective working directory; SDK `session.skills_loaded` notifications remain outside canonical projection because they are transient echoes of session-level discovery rather than durable history.

The server-side session registry in [`../state/AGENTS.md`](../state/AGENTS.md) owns SDK handles. It supplies them to short SDK operations and lends one long-lived handle to each active runtime. Do not introduce a second handle cache or move application teardown into the SDK adapter.

The SDK requires a working directory. Toy Box uses the user's meaningful working directory when one exists and otherwise supplies the home directory only as an SDK fallback. Context normalization hides that fallback from application metadata so list display, inheritance, and resumed tool scope agree on whether the user actually chose one.

## Outbound codecs

Small codecs keep values symmetric across the boundary:

- Attachments map between Toy Box data URLs and SDK blob references.
- Agent notifications encode into ordinary persisted user-message content and decode back into semantic notification events.
- Model configuration maps one domain value into SDK create-session and set-model options.

Keep these codecs narrow. Callers should not learn SDK wire shapes, and the projector should not compensate for values that outbound code could encode consistently.

## Session roles, instructions, and tools

`SessionType` configures a session's product role: `standard`, `automation`, `inbox`, `hyper`, or `worker`. It is not persisted on the SDK session. Creation resolves the type from context already in hand; cold resume derives it from the automation, Inbox, worker, or in-memory Hyper record that manages the session. No managing record means standard, and conflicting records are an invariant violation.

All roles can create child workers that are durable by default or explicitly ephemeral, receive deletion, coordination, and automation tools, and can list, read, and revision-update saved apps. Reads include the active state schema; invalid writes fail before persistence, while conflicts return the current instance for merge-and-retry. App-owned workers receive owner-scoped variants that cannot address another app. Standard and Hyper sessions also receive interactive layout and file tools because they are directly presented in the workspace, plus `validate_artifact_app`, which compiles only a `.toy` file owned by the invoking session. Hyper additionally receives independent top-level session creation, custom-editor registration, and installed app definition and instance lifecycle tools, while Hyper and automation sessions can update user settings through the shared workspace operation. Inbox receives `send_to_inbox`; automation, Inbox, and worker sessions do not receive UI-only open/close tools. Durable child workers link a pane; ephemeral children remain headless so their deletion cannot leave a dead pane. Top-level creation passes only explicitly supplied execution settings, performs no caller-state lookup, and links its new session only when requested.

Session configuration follows the same role model:

- Every session receives its meaningful working directory when one exists.
- Newly created sessions receive their creation model configuration when one was selected explicitly.
- Standard, Hyper, worker, and automation sessions learn their durable session files location and can receive file-edit notifications.
- Feature-owned skills live as complete directories under each feature's
  `server/skills/`. The build embeds every file recursively, and startup replaces
  their generated copies under `~/.toy-box/skills/`. Adding, renaming, or
  removing nested resources requires no installer changes, while
  `SESSION_SKILLS` explicitly controls which roles receive each privileged skill.
- Standard and Hyper receive the bundled `create-toy-box-app` skill on create
  and resume for session artifact apps. Hyper also uses it for installed app
  lifecycle requests and receives `create-toy-box-editor`. Role-owned bundled
  skill directories participate in composer discovery alongside project and
  personal skills. Skill descriptions own routing and their workflow and runtime
  contracts; model-facing tools remain concise control-plane verbs.
- Automation sessions learn that their stable session ID is also their automation ID and can treat artifact edits as feedback on the automation prompt.
- Inbox sessions learn that their session ID is also the Inbox entry ID. They call `send_to_inbox` only when the initial task did not already produce a durable visible outcome, using one concise message and at most one artifact for results that cannot fit naturally in that message.

Model-facing tools are a reverse control plane, not a parallel backend. A tool that exposes an existing server function reuses its input schema and calls that validated operation, so browser and agent ingress share one public contract and one error path. Trusted server-only orchestration calls runtime, state, and lifecycle operations directly when it already owns validated domain values. Lazy imports are intentional where that reverse bridge would otherwise create a module-initialization cycle.

## Invariants

- Every SDK event policy has one owner: the projector.
- Live streaming and history replay must converge on the same `Session` shape.
- SDK handles are cached by the state registry, not by callers or tools.
- Session role changes instructions and tool availability; it does not create a second execution model.
- Tool handlers reuse application operations and preserve their validation, ownership, and lifecycle guarantees.

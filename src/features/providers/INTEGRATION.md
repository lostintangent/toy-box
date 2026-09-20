# Session providers

Sessions owns public identity, drafts, resources, the configured connection registry,
turn queues, subscriptions, question state, completion, and the pure transcript reducer.
Copilot, Codex, and Claude own native processes, authentication, wire formats, and history codecs.
Providers registers the implementations and aggregates native catalogs; workflows
select a model and call ordinary Session operations. Sessions supplies role-specific
instructions, tools, skill directories, and question policy.

Claude uses the installed CLI through the official Agent SDK, including native catalog,
history, naming, deletion, streaming inputs, and an in-process SDK MCP tool host. It adds
no durable storage. Its native session-state signal, with background-work reporting enabled,
controls completion. See [the Claude guide](server/claude/AGENTS.md) for native capabilities
and the conversation-rewind limitation.

| Integration                     | Owner and contract                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Installation and authentication | Provider uses its installed CLI and existing login. Catalog discovery isolates unavailable providers.                                      |
| Model catalogs                  | Provider returns domain model identity plus reasoning and context options. Model identity includes its provider.                           |
| Draft identity                  | Sessions reserves public IDs before provider selection. Native identity is persisted after creation.                                       |
| Discovery and import            | Provider lists native history; Sessions maps native IDs to public IDs and composes workspace metadata.                                     |
| Creation and resume             | Provider receives directory, model, instructions, tools, skills, and question policy. Registry owns one connection and execution lease.    |
| Per-turn models                 | Same-provider changes are supported. A started session retains its provider.                                                               |
| Messages and images             | Provider encodes domain inputs and restores them from native history. Image inputs require no staged files.                                |
| System messages                 | Preserve domain semantics in both live activity and historical replay.                                                                     |
| Queue and cancellation          | Sessions owns the queue. Provider sees only a next turn or immediate steering.                                                             |
| Steering and interruption       | Provider targets the active native turn. Browser disconnect only removes observation.                                                      |
| Events and history              | Both paths project into SessionEvent. The runtime consumes provider end events to drain queued work before publishing completion.          |
| Todos and plans                 | Providers translate native updates into shared TodoItem patches. Codex plans replace the checklist; Copilot keeps its SQL todo projection. |
| Edit statistics                 | Providers supply edit data to the shared patch parser and diff counter. Codex normalizes raw additions/deletions and update hunks.         |
| Questions                       | Provider correlates native requests and answers with domain tool calls, including multi-question requests.                                 |
| Host tools                      | Feature handlers receive public session identity and validated arguments. Providers adapt schemas, results, and terminal behavior.         |
| Skills and MCP                  | Provider combines native configuration with supplied Toy Box skill directories; native MCP configuration remains native.                   |
| Artifacts and files             | Sessions owns artifact locations and discovers files through shared observation and snapshot reads. Providers do not project membership.   |
| Rename and inferred title       | Explicit names are preserved when automatic titles arrive.                                                                                 |
| Rewind                          | Provider removes conversation from the selected root user turn, preserving files.                                                          |
| Delete                          | Provider removes native history; Sessions tears down its owned resources and managed descendants.                                          |
| Snapshot freshness              | Provider decides whether native history still matches the capture time; Sessions owns cache retention and expiry.                          |
| Startup and shutdown            | Providers owns native process discovery and termination; Sessions owns idle connection release.                                            |

Validation must preserve Copilot golden live/history fixtures and prove Codex's protocol
boundary, public/native ID mapping, input round trips, questions, steering, and teardown.
Run the full checks and dogfood both observing clients across active and historical sessions.

## Proven implementations and native limits

Copilot uses `@github/copilot-sdk`; Codex uses bidirectional `codex app-server` JSON-RPC.
Both resolve the installed CLI from PATH and reuse its existing authentication. The
Codex protocol snapshot and native smoke tests use CLI 0.153.2; Copilot tests retain
the existing SDK fixtures and also execute against the installed CLI.

Public session UUIDs are allocated before a provider is chosen. Copilot and Claude reuse that UUID;
Codex allocates its own native identity. The sessions table stores a native ID override only when it differs,
preserving the same public ID across drafts, native history, tools,
artifacts, channels, Inbox, and automations. Native external histories remain discoverable.

The same model name may exist in both catalogs. `{ provider, name }` is its identity;
provider identity is required for every model configuration. A session can switch
models within its provider between turns. Changing providers requires a new session.

Configurable context tiers are currently unavailable in Toy Box for Codex and Claude:

- Codex accepts `model_context_window` overrides on creation and resume, but does not
  restore the override from native history. Its public history API omits the window,
  and its model catalog API omits default and maximum windows.
- Claude supports a native `CLAUDE_CODE_DISABLE_1M_CONTEXT` cap, but the selection is
  absent from exported history and is not restored on resume.

Both providers inherit native context defaults and user configuration. Toy Box adds
no provider-specific persistence to retain context tiers.

Provider failures are isolated during catalog/history discovery, so Codex alone works.
Copilot discovery and context use the SDK's `listSessions()` and `getSessionMetadata()`;
history uses `rpc.sessions.readPersistedEvents()` without resuming. Native history files are not parsed for metadata. An empty
native handle is not yet catalog history; Sessions owns the draft until its first turn.
A private Channel Agent without an explicit model inherits workspace defaults within its existing
provider; a changed default provider applies to new conversations. Discovery reads
session identities and managed ownership across the native catalog request, preserving
public identity when creation or deletion overlaps a refresh. A catalog containing
unknown native histories waits only for pending creations in those providers to finish
recording their identities. Known catalogs and unrelated providers do not wait. Managed backing
sessions remain hidden from the ordinary session list and accessible through their
owning feature; user-selected provider filters apply afterward.

Codex registers deferred native tools in the `toy_box` namespace at creation and
handles their callbacks over app-server stdio. Codex persists the catalog across resume.
Imported conversations keep their native tool catalog and receive best-effort
support. Installed native MCP servers remain available through the owner's configuration.
Both providers receive the same Toy Box definitions, instructions, and bundled skills.

Both providers enable interactive questions for standard and Hyper sessions; unattended
managed roles do not wait for user input. Codex questions can be batched, secret, or
nonblocking. Codex's public history API omits questions, answers, and `update_plan`
checklists, so those are projected live but are absent when rebuilding a session
from native history. Codex retains their underlying tool calls for model context;
plan-mode prose is a separate durable item. The provider owns no Toy Box database
tables; Sessions owns the shared session identities and resources.
Original inputs preserve system-message semantics and images. Images use native image
inputs. Imported local images are read back when available and retain an unavailable-file reference
when their original file has disappeared.

Codex's checklist tool is explicitly enabled with `tools.update_plan.enabled` on
creation and resume. Its plan steps become the same `TodoItem[]` as Copilot todos;
the shared reducer handles replacement and status changes. Both providers use the
existing diff parser and counter. Codex supplies raw contents for added/deleted files
and unified hunks for updates, so its adapter only normalizes that native format.

Session files live under `~/.toy-box/sessions/<public-id>/artifacts` from draft creation
onward. Shared instructions give that directory to either agent. Files owns one shared
artifact watcher for open editors and discovery. Sessions refreshes affected active sessions
through canonical `artifacts_changed` events. Snapshot
reads derive membership from the current directory, including on the client's completion
refresh. Native file events and shell output do not determine artifact membership.
Artifact-only tools stay hidden; ordinary file edits retain their diff presentation.
Arbitrary shell edits do not supply per-tool diff statistics.

Codex conversation rewind targets the start of a native turn; an individual steering
message cannot be a rewind boundary. Its terminal tools are completed by interrupting
the turn after the successful result is recorded; the native API has no terminal-tool
flag. Native approval dialogs and MCP elicitation are not additional Toy Box product
flows: unsupported incoming request methods fail explicitly rather than hanging.

SDK-specific optional presentation, such as Copilot canvases, stays in that provider's
projection. Shared consumers depend only on SessionEvents and domain state, and do not
require every backend to emit every optional event.

Sources: [Codex app-server](https://developers.openai.com/codex/app-server/),
[Codex SDK](https://developers.openai.com/codex/sdk/), and the installed CLI's generated
protocol. The app-server includes experimental methods; protocol upgrades require
boundary tests and a native lifecycle check.

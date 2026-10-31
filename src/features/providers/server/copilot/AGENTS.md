# Copilot provider

`provider.ts` implements the [provider contract](../provider.ts) using the
installed GitHub Copilot CLI and SDK. It owns SDK configuration, catalog, and metadata queries;
`client.ts` owns the shared native process. `connection.ts` adapts one native handle into domain operations;
Sessions alone owns its registry, execution lease, queue, and lifetime.

`projector.ts` translates SDK events, tool aliases, SQL todos, background subagents,
questions, and native canvas activity. `provider.readHistory()` uses that same projector.
Root `assistant.idle` projects the nonterminal `background` status; only `session.idle`
ends execution after background agents and attached shell commands have finished.
Reasoning-only assistant messages with neither text nor tool requests are not transcript
boundaries; they can arrive between another message's streamed text and completion.
Subagent reasoning streams beneath its agent call and resets at each child turn; the reply's
durable `reasoningText` replaces that ephemeral preview, so history converges with live state.
`attachments.ts`, `modelConfiguration.ts`, and `models.ts`
keep native data shapes outside the Sessions model. Shared Toy Box tool effects live
in Sessions' `toolProjection.ts`; Copilot-specific completion rules stay here.
System messages use Sessions' shared display codec in the native `displayPrompt` field and send
with native `system` provenance. The projector decodes those messages before dropping other
model-only system events.
The projector resolves persisted attachment references from native `session.binary_asset`
events or inline blobs returned by `sessions.readPersistedEvents()`. The native reader restores
attachment bytes without activating the session.
Sessions opt in to native image generation, which is not persisted, on both create and resume.
Images in a tool's native output (`result.contents`) become its result attachments; images sent
only to the model (`binaryResultsForLlm`), such as `view` and screenshots, stay out of the transcript.
Copilot saves each generated image under the session-state `images` folder and gives the model
its path (`saved_to:`), as Codex does, so agents can attach it.

Copilot uses the Sessions-owned UUID as its native session ID.
The registry persists the provider and resolves native identity for resume, history, and deletion.
Creation and resume pass the working directory and model selection in the native session
configuration, which applies them without follow-up RPCs. The applied model
seeds the live Session stream at creation and resume; persisted `session.start` and `session.resume`
events project those selections into historical replay.
Explicit/automatic names and conversation-only rewind use native SDK RPCs.
Skills include native discovery and the role-scoped bundled directories supplied by
Sessions. Native permissions follow Toy Box's existing trusted-owner policy: create and resume
set `allow-all` mode, so the CLI doesn't journal each approval with its full file contents.
Headless SDK servers load no bundled plugins, so `client.ts` registers the running CLI version's
cached computer-use plugin at start, and the CLI applies the user's opt-in. If registration fails,
Copilot warns and runs without computer use.
This supplies the provider's tools; Screens itself only lists human-viewable screens.

Session discovery, workspace context, and snapshot freshness use `listSessions()` and
`getSessionMetadata()`; history pages through `rpc.sessions.readPersistedEvents()` without
acquiring a connection. Do not read native history files directly.

Preserve the recorded live/history fixtures under `tests/fixtures`. Changes to native
projection must produce the same canonical reducer state live and after reopen.

Keep native SQL parsing, event aliases, pending-input correlation, SDK permissions,
FFI handling, and non-authoritative background tool completions inside this implementation.

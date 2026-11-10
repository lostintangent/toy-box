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
`attachments.ts` and `models.ts`
keep native data shapes outside the Sessions model. Sessions applies shared Toy Box tool effects
downstream in `toolProjection.ts`. The projector hides only Copilot's own machinery, namely skill
loads, agent-management tools, and todo SQL, and keeps Copilot-specific completion rules.
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
configuration, which applies them without follow-up RPCs. Native `session.start` and
`session.resume` arrive before anyone can subscribe, so the configuration's `onEvent` holds
persisted events for the connection's first subscriber, and live and replayed streams project the
same selections. Ephemeral startup events, such as the title restated on resume, are not held.
Explicit/automatic names and conversation-only rewind use native SDK RPCs.
Skills include native discovery and the role-scoped bundled directories supplied by
Sessions. Native permissions follow Toy Box's existing trusted-owner policy: the create and resume
configuration sets `allow-all` mode, so the CLI doesn't journal each approval with its full file
contents. Each send passes its client ID as the native `clientTurnId`, which the CLI echoes on the
live and persisted `user.message`, so the projector correlates inputs the same way in both.
Headless SDK servers load no bundled plugins, so `client.ts` registers the running CLI version's
cached computer-use plugin at start, and the CLI applies the user's opt-in. If registration fails,
Copilot warns and runs without computer use.
This supplies the provider's tools; Screens itself only lists human-viewable screens.

Session discovery uses `listSessions()`, and a limited one reads only the newest local records it
needs from `rpc.sessions.list`, dropping those `rpc.sessions.enrichMetadata` confirms are empty.
Their fields, workspace context, and snapshot freshness use `getSessionMetadata()`; history pages
through `rpc.sessions.readPersistedEvents()` without acquiring a connection. Do not read native
history files directly.

Preserve the recorded live/history fixtures under `tests/fixtures`. Changes to native
projection must produce the same canonical reducer state live and after reopen.

Keep native SQL parsing, event aliases, SDK permissions, FFI handling, and non-authoritative
background tool completions inside this implementation.

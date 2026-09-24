# Copilot provider

`provider.ts` implements the [provider contract](../provider.ts) using the
installed GitHub Copilot CLI and SDK. It owns SDK configuration, catalog, and metadata queries;
`client.ts` owns the shared native process. `connection.ts` adapts one native handle into domain operations;
Sessions alone owns its registry, execution lease, queue, and lifetime.

`projector.ts` translates SDK events, tool aliases, SQL todos, background subagents,
questions, and native canvas activity. `provider.readHistory()` uses that same projector.
Reasoning-only assistant messages with neither text nor tool requests are not transcript
boundaries; they can arrive between another message's streamed text and completion.
`attachments.ts`, `modelConfiguration.ts`, and `models.ts`
keep native data shapes outside the Sessions model. Shared Toy Box tool effects live
in Sessions' `toolProjection.ts`; Copilot-specific completion rules stay here.
System messages use Sessions' shared display codec in the native `displayPrompt` field and send
with native `system` provenance. The projector decodes those messages before dropping other
model-only system events.
The projector resolves persisted attachment references from native `session.binary_asset`
events or inline blobs returned by `sessions.readPersistedEvents()`. The native reader restores
attachment bytes without activating the session.

Copilot uses the Sessions-owned UUID as its native session ID.
The registry persists the provider and resolves native identity for resume, history, and deletion.
Explicit/automatic names and conversation-only rewind use native SDK RPCs.
Skills include native discovery and the role-scoped bundled directories supplied by
Sessions. Native permissions follow Toy Box's existing trusted-owner policy.

Session discovery and workspace context use `listSessions()` and `getSessionMetadata()`;
history pages through `rpc.sessions.readPersistedEvents()` without acquiring a connection. Do not parse native history files for metadata. The provider
checks the history file's modification time only to validate cached snapshots.

Preserve the recorded live/history fixtures under `tests/fixtures`. Changes to native
projection must produce the same canonical reducer state live and after reopen.

Keep native SQL parsing, event aliases, pending-input correlation, SDK permissions,
FFI handling, and non-authoritative background tool completions inside this implementation.

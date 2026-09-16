# Codex provider

`provider.ts` implements the [provider contract](../provider.ts) through the installed
`codex app-server` process and the owner's existing CLI authentication. The published
TypeScript exec SDK lacks the management and bidirectional request surface needed
here. No additional OpenAI npm SDK or Toy Box login is required.

## Ownership

- `protocol/transport.ts` owns JSONL JSON-RPC framing, correlated responses, independent native
  requests/notifications, process failure, and shutdown. It must continue reading while
  a host tool or user question waits for a response.
- `history.ts` reads full native history without resuming or acquiring a writer. The provider
  projects it for snapshots; the connection also uses it to resolve rewind boundaries.
- `connection.ts` owns one native thread attachment, model selection, turn identity,
  steering, interruption, question batches, tool invocation, and ordered delivery.
  Browser subscriptions never own this connection or stop its execution.
- `provider.ts` registers the supplied tools once as deferred native functions in the
  `toy_box` namespace. Codex retains their definitions on resume; the connection
  handles `item/tool/call` over the same stdio transport. One turn-owned abort
  controller cancels its handlers when interrupted, completed, or disconnected.
- `projector.ts` exposes one native event-to-SessionEvents function for live notifications
  and history. `codexHistoryEvents` adapts stored turns into `turn/completed` notifications;
  the projector owns stable timestamps and native-ID deduplication. `inputs.ts` handles
  skill inputs, media, and staged attachments. Native text-element display spans
  preserve structured system messages and general file attachments; native images
  carry their own bytes. Live and reopened inputs use only native history.
  Failed turns project their `Turn.error.message` through the same `turn/completed` case
  live and during history replay. Retrying `error` notifications are not transcript
  failures; the final `turn/completed` outcome is authoritative.
- `protocol/index.ts` is the checked-in Apache-2.0 upstream protocol generated against CLI
  0.153.2. Run `bun src/features/providers/server/codex/protocol/generate.ts` after a deliberate protocol
  upgrade and verify changed methods against the installed CLI.

## Native constraints

Codex's public history API omits questions, answers, and `update_plan` checklists.
They flow through shared SessionEvents live but are absent when rebuilding from
native history. Underlying tool calls remain in Codex's model context; plan-mode
prose is a separate durable item. The provider owns no Toy Box database tables.

Codex allocates its own thread IDs. Sessions durably binds these to public IDs reserved
before creation. Always use `Thread.id`; `sessionId` can describe a shared fork family.
New threads use paginated native history. Imported legacy histories use the legacy
read/rollback path; paginated histories use full turn pages and thread/revert.
Conversation rewind only targets the first input of a turn, so steered inputs are
marked non-rewindable. Deletion uses thread/delete, not archival.

User-input requests can contain several questions, allow secrets, and be nonblocking.
Answers are collected into one native response. Resolving, interrupting, or disconnecting
cancels remaining questions. Unknown native requests receive an explicit RPC error.
Toy Box's trusted-owner policy supplies native approval/sandbox configuration; a new
approval flow belongs in the Sessions contract before exposing additional policies.

Successful terminal tools reject subsequent host calls in their turn. Interruption
waits until Codex records the successful dynamic tool result, then targets that native turn.
This ordering is essential to preserve the result in durable history.

Verify real CLI create/resume, deferred tool discovery and invocation, questions, terminal results,
rename, and deletion alongside protocol tests and the shared reducer/queue fixtures.

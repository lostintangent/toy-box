# Session State

Session state owns the authoritative server lifecycle surrounding the canonical session model. It
bridges durable provider history and session-owned resources to the one live runtime without
creating another source of transcript truth.

## Responsibilities

- `registry.ts` owns cached provider connections, single-flight resume, creation, explicit rename, automatic
  title updates, and complete deletion. Cached sessions retain their application-supplied
  configuration lifetime; runtime acquisition replaces a private Channel Agent session when its
  effective configuration changed, while unchanged Channel Agents and ordinary Sessions reuse their
  cached session. Active executions retain that session; bounded provider operations restart its idle
  window. Idle sessions disconnect after 30 minutes and resume from durable provider history on their
  next execution or control operation. History reads bypass connections. Managed supervisors may release a retained session immediately once their workflow
  reaches a terminal state.
  Accepted explicit and automatic title changes publish workspace metadata here; callers do not
  depend on a provider echoing a native rename event.
  One deletion path releases the live runtime, provider persistence, worktree, session record, cached
  snapshot, managed relationships, pin, and workspace projection before publishing the deletion.
  Native connections finish disconnecting before their history is deleted, so a final flush cannot
  recreate a deleted session.
- `snapshots.ts` reconstructs `SessionState` through provider history projection and the canonical
  reducer, then caches that same value under the caller-supplied session ID. Active truth always
  comes from the runtime; cached snapshots only avoid replay work.
- `schema.ts` defines the Sessions-owned `sessions` and `worktrees` tables. `sessions.ts` owns
  durable public identity in the `sessions` table. A row without a provider
  is a draft; native creation adds its provider to that same row. Record reads return `Session`;
  catalog discovery enriches it with native metadata. `native_id` is an optional override:
  when absent, the canonical session UUID is also the native ID. Providers own
  names and message and attachment history, including after rewind.
- `worktrees.ts` keeps a session worktree and its SQLite record in one lifecycle.
  Apply and merge require committed session changes and operate in the source checkout;
  unfinished edits reject the operation before any resource is removed.
  The shared SQLite connection remains application infrastructure in
  [`../../../../server/database.ts`](../../../../server/database.ts). Workspace status and shared
  snapshot composition remain in [`../../../../workspace/AGENTS.md`](../../../../workspace/AGENTS.md).
  Application-level role classification and managed ownership remain in
  [`../../../../server/managedSessions.ts`](../../../../server/managedSessions.ts).

## Boundaries and invariants

- The [runtime](../runtime/AGENTS.md) is the public server capability used by managed features.
  They create, inspect, wait for, abort, and delete sessions without reaching into this storage
  implementation or the provider adapter.
- [Providers](../../../providers/AGENTS.md) owns native wire formats and history codecs. Sessions owns universal instructions, tools, and role configuration; the registry owns connections and teardown.
- A live session is authoritative while it exists; an idle session is reconstructed from SDK
  history. A snapshot is never a second authority.
- A session resource has one teardown path. Callers must not independently coordinate provider state,
  worktrees, session records, snapshots, or workspace projections.

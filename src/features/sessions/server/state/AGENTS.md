# Session State

Session state owns the authoritative server lifecycle surrounding the canonical session model. It
bridges durable Copilot history and session-owned resources to the one live runtime without
creating another source of transcript truth.

## Responsibilities

- `registry.ts` owns SDK handles, single-flight resume, creation, explicit rename, automatic title
  updates, and complete deletion.
  One deletion path releases the live runtime, SDK persistence, worktree, draft claim, cached
  snapshot, worker relationship, pin, and workspace projection before publishing the deletion.
- `snapshots.ts` reconstructs idle state through the SDK projector and canonical reducer, then
  caches that result. Active truth always comes from the runtime; cached snapshots only avoid
  replay work.
- `drafts.ts` persists zero-turn session claims and optional artifact identity.
- `worktrees.ts` keeps a session worktree and its SQLite record in one lifecycle.
- `sessionType.ts` resolves the one product role governing a session. No managing record means standard;
  conflicting Automation, Inbox, Hyper, or Worker claims are invalid.

The shared SQLite connection remains application infrastructure in
[`../../../../server/database.ts`](../../../../server/database.ts). Workspace status and shared
snapshot composition remain in [`../../../../workspace/AGENTS.md`](../../../../workspace/AGENTS.md).

## Boundaries and invariants

- The [runtime](../runtime/AGENTS.md) is the public server capability used by managed features.
  They create, inspect, wait for, abort, and delete sessions without reaching into this storage
  implementation or the SDK adapter.
- The [SDK boundary](../sdk/AGENTS.md) owns Copilot wire formats, history projection, instructions,
  and client operations. The registry owns application handles and teardown.
- A live session is authoritative while it exists; an idle session is reconstructed from SDK
  history. A snapshot is never a second authority.
- A session resource has one teardown path. Callers must not independently coordinate SDK state,
  worktrees, draft claims, snapshots, or workspace projections.

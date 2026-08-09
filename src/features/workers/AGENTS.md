# Workers

Workers are ordinary managed sessions whose lifecycle belongs to another resource. They let sessions delegate work, files run serialized background edits, and apps run hidden implementation work without creating another execution model.

## Domain model

Every worker has one immutable owner and one independent lifetime:

- A session-owned worker inherits context from its parent. It is durable by default and is deleted with the parent.
- A file-owned worker belongs to one session file, executes in that file's serial queue, and is always ephemeral.
- An app-owned worker belongs to one saved app, runs concurrently with its siblings, and is ephemeral by default.

Ownership determines admission, visibility, inherited context, capability scope, and recursive teardown. `ephemeral` determines only whether the supervised session is deleted after its current execution. `model/` owns these concepts, the file/app RPC schemas, and ownership helpers. File/app inputs cross an RPC trust boundary, so their TypeScript types are inferred from those schemas. Session ownership is injected from a validated tool invocation and remains an internal TypeScript type.

## Admission and supervision

`server/functions.ts` is the validated browser ingress for file- and app-owned spawn and cancel commands. `server/tools.ts` owns the distinct `create_worker_session` tool contract; it validates the agent's task and execution options, injects the invoking session as owner, and calls the trusted worker lifecycle directly.

Admission verifies the owner before publishing a pending worker. File work enters a per-file queue; app work begins immediately. Cancellation verifies that owner, removes pending visibility at once, rejects completion waiters, and delegates any live execution to the supervisor. A removed queued worker becomes a no-op when its slot arrives.

The supervisor composes the ordinary session runtime with worker policy. It inherits parent context and model when applicable, closes cancellation races before a stream exists, returns an exact completion receipt, and deletes ephemeral sessions after execution. Startup deletes ephemeral worker sessions abandoned by a prior process rather than pretending their execution can resume.

`server/database.ts` persists worker ownership so session type, recursive deletion, app cleanup, and startup recovery survive restarts. `server/registry.ts` owns the process-local queued/running projection and publishes `worker.started` and `worker.finished`. App deletion asks Workers for one `deleteWorkersForApp` operation; Apps does not coordinate the registry, database, supervisor, or session teardown itself.

## Client synchronization

`workerMutations` is the request/response client API. File and app owners submit spawn and cancel commands through mutations; workflows retain only their real prerequisites, such as flushing a file or app state before spawning. `WorkersMenu` owns its cancellation observer so pending UI is local to the row that initiated it.

Workers deliberately have no separate `queries.ts`. The live registry is one projection in the canonical workspace snapshot, and its events flow through the same workspace SSE reducer between snapshots. Files and apps select their owned workers from that cache. Creating a second worker query would duplicate identity and recovery authority without providing an independent resource to fetch.

## Boundaries and invariants

- [`../files/AGENTS.md`](../files/AGENTS.md) owns file content, save flushing, and renderer integration. Workers owns admission, serialization, execution, cancellation, and worker visibility.
- The [Sessions runtime](../sessions/server/runtime/AGENTS.md) owns session execution, streaming, and exact completion. Workers composes those mechanics with ownership and retention policy.
- [Sessions](../sessions/AGENTS.md) owns generic session teardown, while [Workspace](../../workspace/AGENTS.md) owns snapshot and event composition. Workers owns its durable records and process registry.
- The [Sessions SDK boundary](../sessions/server/sdk/AGENTS.md) owns role-based tool selection and session instructions. Workers owns the child-worker tool contract and handler.
- One worker ID identifies its pending registry entry, managed session, completion waiters, and durable ownership row. Never introduce a second worker execution or status model.

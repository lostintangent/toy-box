# Workers

Workers are owner-bound Session identities. They let a Session delegate work, a file run a background
edit, an app run private implementation work, or a Channel retain its lead and members without
introducing another execution model.

## Model

A `Worker` reserves one Session ID plus an immutable owner and lifetime. Task Workers create their
backing Session immediately. A Channel lead starts when its Channel is created, while member Workers
create their backing Sessions lazily when first mentioned. Optional `name` and opaque `metadata` are
owner-provided details, not another generic identity model.

- A session-owned Worker inherits its parent's model and directory unless overridden and is retained
  by default.
- A file-owned Worker belongs to one exact session file and is always ephemeral.
- An app-owned Worker belongs to one saved app and is ephemeral by default.
- A channel-owned Worker is durable until member or Channel deletion. Channels interprets its name
  and metadata as member identity, read position, and collaboration status. The Channel derives its
  intrinsic lead's fixed identity and owns its model.

`ephemeral` is the complete lifetime policy. An ephemeral Worker's Session is deleted after its
current execution. A durable Worker survives for follow-up until explicit or owner deletion.
Worktree isolation remains a Session concern.

The Worker model deliberately knows no Agent role, Channel status, file editor task, or app state.
Owners validate and interpret metadata at their own boundary. This is the same pattern used by
`useFile`: Files selects its Workers by owner, presents their names and metadata, and invokes generic
spawn or cancel operations.

## Algebra

Workers owns three capabilities:

- **Spawn** validates or injects an owner, publishes active work, and creates its backing Session.
- **Cancel** verifies ownership, clears active work, and stops startup or execution.
- **Delete** removes the backing Session and its durable ownership record.

Untrusted file and app creation enters through `server/admission.ts`. `server/supervisor.ts` composes
Session creation with inheritance, cancellation, exact completion, and ephemeral cleanup. Channel
member Workers are created before their first mention and begin their backing Session lazily on that
mention. The lead Worker is created transactionally with its Channel and starts immediately.

Waiting remains a Session operation. Admission registers completion before publishing
`worker.started`, so fast ephemeral work cannot disappear before `waitForSessions` observes it.

## Boundaries

- `model/` owns the Worker value, owner variants, and externally validated spawn and cancel inputs.
- `server/schema.ts` and `server/database.ts` persist the owner, lifetime, name, and metadata needed to
  classify, recover, and delete a Worker.
- `server/registry.ts` contains only currently admitted background work and publishes
  `worker.started` and `worker.finished`. Durable Channel membership is not active work.
- `components/WorkersMenu.tsx` presents active background work. Files and Apps select the Workers they
  own. Channels presents its durable Workers as the lead and members.
- Sessions owns execution, history, streaming, completion, provider configuration, and worktrees.
- Owners own all interpretation of their metadata and any richer public projection.

The Worker table is the only durable ownership record. An owner may compose `WorkerDatabase` into its
own transaction and resolve its own Session configuration or lifecycle behavior at the application
composition boundary. There is no second generic membership table, host abstraction, or parallel
managed-session type.

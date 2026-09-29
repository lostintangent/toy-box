# Workers

Workers are owner-bound Session identities. They let a Session delegate work, a file run a background
edit, an app run private implementation work, Inbox supervise background results, or a Channel retain its lead and members without
introducing another execution model.

## Model

A `Worker` has one Session ID, creation time, immutable owner, and lifetime. Spawning constructs
and persists that identity and starts its first execution. Channel members start onboarding when
they join; subsequent mentions use normal Session delivery. Optional `name` and opaque `metadata`
are owner-provided details. Owners validate their metadata's meaning; Workers validates bounded JSON
before publishing a new Worker or updating its metadata.

`WorkerSpawn` combines a Session launch with an owner, optional name and metadata, and a retention
policy. Trusted owners may supply a shared Session ID. Channels uses its own ID for its lead.

- A session-owned Worker inherits its parent's model and directory unless overridden and is retained
  by default.
- A file-owned Worker belongs to one exact session file and is always ephemeral.
- An app-owned Worker belongs to one saved app and is ephemeral by default.
- A channel-owned Worker is durable until member or Channel deletion. Channels interprets its name
  and metadata as member identity, read position, and collaboration status. The Channel derives its
  intrinsic lead's fixed identity and owns its model.
- An Inbox-owned Worker supplies a retention callback that keeps reported results and failures.
  Workers deletes clean completions without a result. Its metadata carries the Inbox message and
  optional artifact path.

Trusted spawning takes one `retention` policy: `"ephemeral"`, `"durable"`, or a callback receiving the
latest persisted Worker and its `SessionCompletion`. An ephemeral Worker's Session is deleted after
its current execution. A durable Worker survives for follow-up until explicit or owner deletion.
A callback returns true to retain or false to delete and may perform asynchronous owner-specific
finalization. Workers awaits that decision and cleanup before completing the receipt or clearing
active work. Cancellation and missing ownership bypass the callback; a callback exception retains
ownership and rejects completion.

The persisted `ephemeral` flag is derived from that policy. Callback-based work is stored as durable;
callbacks are process-local, and owners recover interrupted work after a restart. Startup and
execution exceptions after admission become failed completion data with an error string. Failures
before admission and cancellation during startup clean up the reservation. Worktree isolation
remains a Session concern.

The Worker model deliberately knows no Agent role, Channel status, file editor task, or app state.
Owners validate and interpret metadata at their own boundary. This is the same pattern used by
`useFile`: Files selects its Workers by owner, presents their names and metadata, and invokes generic
spawn or cancel operations.

## Algebra

Workers owns lifecycle and owner-scoped storage capabilities:

- **Spawn** validates or injects an owner, assigns identity and creation time, publishes active work,
  persists admission, and creates the backing Session. An optional trusted `admit` callback can
  compose Worker persistence with an owner's atomic domain changes before execution starts;
  its return value becomes the receipt's typed `value`.
- **Cancel** verifies ownership, clears active work, and stops startup or execution.
- **Delete** removes the backing Session and its durable ownership record.
- **Read/update** lists retained Workers by type or exact owner, resolves an owned Worker, and
  updates name/metadata by Worker ID without changing ownership, identity, creation time, or lifetime.
  Omitted details remain unchanged; an explicit undefined metadata value clears it. Updates throw
  for a missing Worker. Initialization separately fills only absent metadata, returning false for
  existing metadata or missing ownership. Commands acknowledge writes; reads own projections.

Untrusted file and app creation enters through `spawnWorkerFromRequest` in `server/admission.ts`.
The trusted `spawnWorker` admits ownership; `superviseWorker` in `server/supervisor.ts` composes
Session creation with inheritance, cancellation, exact completion, and retention. Trusted
supervisors use the public `spawnWorker` with a complete `SessionLaunch`, `owner`, optional `name`
and `metadata`, and a required `retention` policy. Workers assigns the Session ID and creation time;
callers supply intent rather than constructing a persisted Worker. Supervisors apply their admission
policy before spawning. They receive the admission receipt once ownership is persisted and Session acquisition has been
registered, without waiting for provider startup or the first turn to finish. Follow-ups then join
Sessions’ existing acquisition and mailbox. Preparation failures remain failed completion data.
An owner can return its committed domain value directly from `admit` and receive it as `receipt.value`,
without capturing mutable outer state or re-reading storage. Its `waitForCompletion`
covers configuration inheritance, provider startup, execution, retention, and lifetime cleanup.
Admission failures reject spawning; retention and cleanup exceptions reject completion. File, App,
and Session tool ingress await the same admission boundary and return the serializable Session ID.
Inbox and Channels use this path for creation. Channel admission commits the lead with its Channel,
or a member with its membership message, before execution begins. Later mentions use Session delivery;
Channels has no separate activation operation or startup queue.

Waiting remains a Session operation. Admission registers completion before publishing
`worker.started`, so fast ephemeral work cannot disappear before `waitForSessions` observes it.
Unsuccessful execution outcomes remain data, including startup exceptions. Active Workers are
available through the public read API so owners can distinguish current supervision from retained
ownership.

## Boundaries

- `model/` owns the Worker value, owner variants, and externally validated spawn and cancel inputs.
- `server/schema.ts` and `server/database.ts` persist creation time, owner, lifetime, name, and metadata needed to
  classify, recover, and delete a Worker.
- Application composition projects those records into Sessions' typed ownership index, including
  parent relationships, so generic consumers need no separate Worker-classification cache.
- `server/registry.ts` contains only currently admitted background work and publishes
  `worker.started` and `worker.finished`. Durable Channel membership is not active work.
- `components/WorkersMenu.tsx` presents active background work. Files and Apps select the Workers they
  own. Channels presents its durable Workers as the lead and members.
- Sessions owns execution, history, streaming, completion, provider configuration, and worktrees.
- Owners own all interpretation of their metadata and any richer public projection.
- Worker persistence and metadata operations do not publish owner-specific events. Owners publish
  their accepted workflow changes; application composition handles owner notification during shared
  Session teardown. Unregistration reports whether it removed a row so concurrent teardown does not
  publish duplicate deletions. Raw `WorkerDatabase` operations remain composable into transactions.
- Metadata writes enforce the shared bounded-JSON contract before changing a row. SQLite enforces
  JSON validity; reads decode that JSON without reapplying write limits to historical records.
  Owners decide how to present metadata that no longer satisfies their own result schema.

The Worker table is the only durable ownership record. An owner may compose `WorkerDatabase` into its
own transaction and resolve its own Session configuration or lifecycle behavior at the application
composition boundary. There is no second generic membership table, host abstraction, or parallel
managed-session type.

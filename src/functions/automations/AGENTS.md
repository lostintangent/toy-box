# Automations

Automations let users turn a prompt into dependable recurring work that runs without an open browser and remains observable as an ordinary Toy Box session. This subsystem owns durable definitions and scheduling, while deliberately reusing the session runtime so manual and scheduled runs behave like ordinary session work.

## Domain model

An automation is a durable definition containing a title, prompt, model, cron schedule, and optional working directory, plus `nextRunAt` and `lastRunAt` lifecycle metadata. Its `toy-box-auto-…` ID is also the stable ID of the session it manages. That identity persists across occurrences, while each run replaces the previous idle SDK conversation so it starts with a clean transcript. No separate run ID or reusable-session option exists.

The public operations are `list`, `create`, `update`, `delete`, and `run`. Top-level server functions validate those contracts; the SDK automation tools call the same operations rather than maintaining another control path.

Creation and update validate the cron expression and calculate the next occurrence in the server's local timezone. Deletion removes the managed session before deleting the definition, so an automation and its transcript never become independently orphaned resources.

## Scheduling

One scheduler loop starts with the Nitro server and periodically claims due work. `claimDue` runs inside an immediate SQLite transaction: it selects due definitions and advances each claimed `nextRunAt` before dispatch. Advancing while the claim is held prevents another tick from selecting the same occurrence.

Missed intervals collapse into one current run instead of producing a catch-up storm. Malformed definitions cannot prevent valid work from being claimed, and scheduler ticks never overlap within the process.

Manual requests and claimed schedules both call `startAutomationRun`. Whether a run was requested by a user or claimed by the scheduler does not change its execution semantics.

## Run lifecycle

Each run follows one path:

1. Concurrent start attempts for the same automation share the pending start. Later callers receive the same session ID with `started: false`.
2. If that stable session ID already has a live runtime, the attempt returns `started: false`; automation prompts never queue behind an overlapping run.
3. Otherwise, any idle persisted session with that ID is deleted so the new run begins with a clean transcript.
4. `createSession` creates the fresh automation session through its first prompt with the configured model, working directory, and title.
5. The caller returns after delivery starts. Background completion records `lastRunAt` and publishes the updated automation definition.

The session runtime owns every execution transition: creation publishes creating, the first turn publishes running, and stream closure publishes idle or unread. Automation events only synchronize durable definition and schedule metadata. A creation failure restores idle session status without changing `lastRunAt`; a metadata persistence failure leaves no changed automation row to publish.

## Client synchronization

`useAutomations` owns the definition query, CRUD and run mutations, and durable `AutomationEvent` projection into React Query. Every connection or focus refetch repairs notifications missed from the at-most-once update stream.

A user-triggered run optimistically marks the stable automation session ID as creating and opens it. A genuinely new run seeds an empty session detail so the prior transcript cannot flash while the reset stream connects. Automation list items derive running and unread directly from workspace session state rather than maintaining a second run-status model.

Automation sessions are excluded from the standard session list because the automation panel is their managed presentation. They remain ordinary sessions to the runtime and can be opened, streamed, and inspected through the same session UI.

## Boundaries and invariants

- [`../runtime/AGENTS.md`](../runtime/AGENTS.md) owns delivery, execution, completion, and transcript streaming. Automation code schedules and observes that runtime; it does not reproduce it.
- [`../state/AGENTS.md`](../state/AGENTS.md) owns the shared database connection, managed session teardown, and workspace status transitions. `AutomationDatabase` owns only automation rows and schedule metadata.
- [`../sdk/AGENTS.md`](../sdk/AGENTS.md) owns automation-specific instructions and tools. Those tools call the same validated automation operations as the UI.
- One automation ID identifies the definition, its managed session, and its client status. Preserve that single identity across every layer.
- Prevent overlap before delivery and advance schedules before dispatch. Session status remains authoritative even if automation metadata persistence fails.

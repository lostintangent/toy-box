# Automations

Automations let users turn a prompt into dependable recurring work that runs without an open browser and remains observable as an ordinary Toy Box session. This subsystem owns durable definitions and scheduling, while deliberately reusing the session runtime so manual and scheduled runs behave like ordinary session work.

## Domain model

An automation is a durable definition containing a title, prompt, model, cron schedule, and optional working directory, plus `nextRunAt` and `lastRunAt` lifecycle metadata. Its UUID is also the stable public ID of the session it manages. That identity persists across occurrences, while each run replaces the previous idle provider conversation so it starts with a clean transcript. No separate run ID or reusable-session option exists. Automation membership comes from its durable definition, never from the ID's spelling.

The public operations are `list`, `create`, `update`, `delete`, and `run`. `server/index.ts` owns their lifecycle, publication, managed-session teardown, and dispatch. UI commands in `server/functions.ts` and model-facing tools in `server/tools.ts` validate inputs with the same schemas before calling that lifecycle; UI reads use the workspace snapshot. Trusted server orchestration calls that underlying lifecycle directly only when it already owns validated domain values.

Creation and update validate the cron expression and calculate the next occurrence in the server's local timezone. Deletion removes the managed session before deleting the definition, so an automation and its transcript never become independently orphaned resources.

## Scheduling

One scheduler loop starts with the Nitro server and periodically claims due work. `claimDue` runs inside an immediate SQLite transaction: it selects due definitions and advances each claimed `nextRunAt` before dispatch. Advancing while the claim is held prevents another tick from selecting the same occurrence. Each committed claim is published before dispatch so clients receive its new schedule even if execution cannot start.

Missed intervals collapse into one current run instead of producing a catch-up storm. Malformed definitions cannot prevent valid work from being claimed, and scheduler ticks never overlap within the process.

Manual requests and claimed schedules both call `runAutomation`. Whether a run was requested by a user or claimed by the scheduler does not change its execution semantics.

## Run lifecycle

Each run follows one path:

1. Concurrent start attempts for the same automation share the pending start. Later callers receive the same session ID with `started: false`.
2. If that stable session ID already has a live runtime, the attempt returns `started: false`; automation prompts never queue behind an overlapping run.
3. Otherwise, `recreateSession` privately tears down any idle persisted execution so the new run begins with a clean transcript, then publishes the replacement draft while its provider connection starts. The stable session identity is never published as deleted.
4. The runtime creates the fresh automation session through its first prompt with the configured model, working directory, and title.
5. The caller returns after delivery starts. On completion, the automation supervisor records
   `lastRunAt`, publishes the updated definition, and releases the now-idle SDK session while
   preserving the result for inspection and follow-up.

The session runtime owns every execution transition: the first turn publishes running, and stream closure publishes idle or unread. Automation events only synchronize durable definition and schedule metadata. A creation failure leaves the automation idle without changing `lastRunAt`; a metadata persistence failure leaves no changed automation row to publish.

## Client synchronization

Automation definitions are part of the shared workspace query projection alongside Inbox entries and other managed-session state. `automationQueries` exposes that projection as the feature's read API, while `automationMutations` owns CRUD and run requests plus their immediate client cache effects. Components consume those options directly and retain only local interaction state. `useWorkspaceSync` applies server events, reuses the SSR snapshot when the initial stream revision matches, and refetches after missed updates or reconnects.

The mounted automation dialog owns one schedule draft. Daily, interval, and cron are editing modes; inactive tab inputs are remembered, and only the selected mode determines the saved cron.

A user-triggered run displays as running immediately through the mutation's pending state, without opening its pane. The mutation calls Sessions' `recreateSessionInCache` with the cached prompt and model. Only the automation ID and client message ID accompany the request; the server uses the saved definition and carries that message ID into delivery. Sessions owns replacing the old transcript and reconciling the canonical message. Settled requests call Sessions' `invalidateSessionQueries` to reconcile success, overlap, or failure. Automation list items combine the pending request with workspace activity for presentation; the server announces running when the live stream exists.

Automation events synchronize durable definition and schedule metadata through the workspace event algebra. Automation sessions are excluded from the standard session list because the automation panel is their managed presentation. They remain ordinary sessions to the runtime and can be opened, streamed, and inspected through the same session UI.

## Boundaries and invariants

- The [Sessions runtime](../sessions/server/runtime/AGENTS.md) owns delivery, execution, completion, and transcript streaming. Automation code schedules sessions and waits for their completion; it does not reproduce the runtime.
- [`../../server/database.ts`](../../server/database.ts) owns the shared database connection and
  composes feature schemas. `server/schema.ts` defines the Automation table, while
  `AutomationDatabase` owns its rows and schedule metadata. [Sessions](../sessions/AGENTS.md) owns
  managed session teardown, and [Workspace](../../workspace/AGENTS.md) owns the aggregate client
  projection.
- `server/tools.ts` owns the automation's model-facing tools and role instructions. Application
  composition supplies them to the [session provider boundary](../providers/INTEGRATION.md), and
  tools share the UI's input schemas and call the same domain operations.
- One automation ID identifies the definition, its managed session, and its client status. Preserve that single identity across every layer.
- Prevent overlap before delivery and advance schedules before dispatch. Session status remains authoritative even if automation metadata persistence fails.

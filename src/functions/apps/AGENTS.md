# Apps

Apps are durable, reopenable workspace surfaces whose behavior is not tied to a file
extension. The domain has three durable values:

- An `AppDefinition` is installed code, metadata, and a state contract with its default. Built-ins ship
  with Toy Box; owner definitions live under `~/.toy-box/apps/<id>/` as `app.json`
  and one `app.tsx`.
- An `AppInstance` is one saved use of a definition. SQLite owns its ID, title,
  icon color, small JSON state, optimistic revision, and timestamps.
- An `AppShare` is immutable, MIME-typed JSON content one instance has offered to another.
  SQLite retains it until the receiving instance consumes it; sharing does not
  execute app code or turn an app into a session.

The server owns both lifecycles. `src/functions/apps.ts` is the validated RPC
boundary used by the client. Within this subsystem, `state/` owns the filesystem
definition registry and SQLite instance repository, `compiler/` produces browser
bundles, and `lifecycle/` coordinates transitions that cross those authorities;
its private `gist.ts` adapts one installation source. `index.ts` is the narrow
server-side lifecycle surface used by RPC handlers and agent tools.

## Definition lifecycle

At startup, the registry discovers built-ins and structurally valid owner definitions
without compiling their bundles. Built-in IDs reserve the `toybox-` prefix, which
owner definitions cannot use.

Registration reads an owner's existing files, validates the state schema and default,
typechecks the TSX against the schema-derived `useApp()` type, and compiles the complete
candidate, then makes that revision active and emits `app.registered`.
Invalid or partially edited files never replace the process-local last-known-good
revision; the files remain the durable authority. Opening an instance resolves its
definition metadata from workspace state and fetches its bundle by definition ID and
revision, compiling and caching that revision on demand when necessary.

Gist installation downloads exact `app.json` and `app.tsx` files, follows the same
validation and activation contract, and creates the definition's first saved
instance. Uninstall is limited to owner definitions, refuses while any instance
references the definition, removes its files, and emits `app.unregistered`.

## Instance lifecycle

Creation resolves an active definition, seeds its icon color and default state unless
the caller provides them, inserts the instance in SQLite, and emits `app.upserted`.
Updates are revision-checked compare-and-swap writes and emit the same event.
Deletion removes the row, emits `app.deleted`, and cleans up every app-owned
worker; ordinary sessions remain independent unless the app explicitly deletes
them. SQLite also removes shares involving the deleted instance, and the same
event removes them from connected clients.

Definitions declare the MIME types their instances accept. `shareWithApp`
validates that capability, persists the immutable share, and emits
`app.share.created`; `consumeAppShare` is scoped to the receiving instance and
emits `app.share.deleted`. Shares use the ordinary workspace snapshot and event
stream, so a receiving app can be closed when context is shared with it.

Instances and definitions appear in the ordinary workspace snapshot. Their
at-most-once events keep connected clients current, while snapshot refetch repairs
missed events. Definition-sensitive transitions are serialized by definition ID;
ordinary instance updates remain independently optimistic.

## Compilation and runtime

An app definition exports one React TSX component. Installation, registration, and
the first bundle load after a restart run the same typecheck-and-compile pipeline,
caching the browser bundle under its content-derived revision.
`compiler/typecheck.ts` checks the single authored file against only the declared
runtime dependencies. It owns the TypeScript program and a definition-local virtual
`@toy-box/sdk` module whose `useApp()` state type is inferred from the manifest by
`json-schema-to-ts`. The shared dependency catalog in `src/lib/apps/runtime.ts` drives
the compiler allowlist and runtime bridge; `compiler/dependencies.ts` adapts that
catalog into Bun modules. Development checks read declarations from the repository,
while `cli/build.ts` stages the same package-shaped, declaration-only environment as
a Bun executable asset for standalone checks. The compiler's `index.ts` owns the one
compile pipeline and Bun bundler, while `styles.ts` compiles scoped CSS.

Static Tailwind classes use the shared Toy Box theme; custom CSS may live in a
scoped `<style>` element. Authored code may import `react`, `zod`, `@toy-box/sdk`,
and the curated `lucide-react` exports.

Apps are trusted owner-installed code running in Toy Box's page, not a security
sandbox. The import allowlist makes the contract narrow and portable.

`src/lib/apps/sdk.ts` declares the complete versioned `@toy-box/sdk` author API.
`panes/app/runtime/sdk/` assembles its browser implementation from hooks and components,
and `runtime/libraries.ts` checks that module against the contract while supplying it to
compiled apps:

- `useApp` exposes the mounted instance, its pending shares, schema-validated
  durable state and updates, and its host actions. State writes are optimistic, debounced, serialized,
  conflict-replayed, and rolled back on failure.
- `useWorkspace(selector)` exposes a structurally shared projection of standard
  sessions and their durable child-session trees, saved apps, models, published
  panes, and workers owned by the app.
- `useFile` exposes the same live file lifecycle used by editor panes,
  including queued saves, external updates, modes, and file-owned workers.
- App actions compose ordinary Toy Box session, worker, file, and pane operations.
  One `waitForSession` monitor waits for ordinary sessions and workers;
  worker admission still owns cancellation and disposal. App workers independently
  receive owner-scoped `get_app` and `update_app` tools. Every session can
  use the corresponding addressable tools to coordinate saved apps; reads include
  the active schema, writes validate it, and revision conflicts return current state.
- `AppShell`, `AppHeader`, standard feedback and session-toggle controls, and model,
  file, location, and share pickers provide host-aware UI. The share picker owns
  target discovery, persistence, and revealing the receiver as an independent root
  on the current surface. React state owns ephemeral interaction state.

An `AppPane` composes one mounted app from two private sides. `panes/app/host/` binds
durable state, workspace projections, app actions, and bundle execution to Toy Box.
`panes/app/runtime/` is composed of the authored SDK (hooks and components), the
curated icon module, and the pre-bundled libraries supplied to compiled code. The pane
owns their React lifetime and publishes linked panes through the ordinary workspace
pane model; host mechanics are not part of the authored module.

## Invariants

- Definitions and instances remain separate authorities and lifecycles.
- App state is JSON capped at 64 KiB, never a transcript or file-content store.
- One manifest state contract drives the default, runtime validation, compiler typing,
  and agent introspection; authored TSX never restates or passes that contract.
- Apps reuse ordinary sessions, files, workers, panes, workspace state, and events.
- Shares transfer MIME-typed JSON content; only sessions execute messages.
- Deleting an instance cleans up all of its app-owned workers.
- Breaking author-API changes require a new runtime module contract.

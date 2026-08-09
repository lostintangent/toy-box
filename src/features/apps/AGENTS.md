# Apps

Apps are durable, reopenable workspace surfaces whose behavior is not tied to a file
extension. The feature owns three durable values:

- An `AppDefinition` is installed code, metadata, and a state contract with its
  default. Every definition is an ordinary `~/.toy-box/apps/<id>/app.json` and
  `app.tsx` pair.
- An `AppInstance` is one saved use of a definition. SQLite owns its ID, title,
  icon color, small JSON state, optimistic revision, and timestamps.
- An `AppShare` is immutable, MIME-typed JSON content one instance has offered to
  another. SQLite retains it until the receiving instance consumes it; sharing
  does not execute app code or turn an app into a session.

The feature is organized by responsibility:

- `model/` owns schemas and domain values shared across the boundary.
- `queries.ts` and `mutations.ts` are the browser's declarative access to app
  reads and operations.
- `components/` owns the Apps sidebar and workspace pane. Its private `host/`
  modules adapt Toy Box capabilities to a mounted app; `runtime/` implements the
  authored SDK in the browser.
- `sdk.ts` is the complete public authoring contract for `@toy-box/sdk`, while
  `runtime.ts` defines the versioned compiler-to-host module bridge.
- `server/functions.ts` is the validated RPC ingress. `server/index.ts` owns
  lifecycle orchestration over the definition registry, SQLite store, compiler,
  and Gist installer. Agent tools and authoring guidance live beside those server
  capabilities in `server/tools.ts` and `server/skills/`.

## Definition lifecycle

At startup, the registry discovers structurally valid definition files without
compiling their bundles. Registration reads the existing files, validates the state
schema and default, typechecks the TSX against the schema-derived `useApp()` type,
and compiles the complete candidate. Only then does it make the content-derived
revision active and emit `app.registered`. Invalid or partially edited files never
replace the process-local last-known-good revision; the files remain the durable
authority.

Opening an instance resolves definition metadata from workspace state and fetches
its bundle by definition ID and revision. The server compiles and caches that exact
revision on demand when necessary. Gist installation writes ordinary `app.json` and
`app.tsx` files, follows the same validation and activation contract, and creates
the definition's first saved instance. Uninstall refuses while an instance still
references the definition, removes its files, and emits `app.unregistered`.

## Instance lifecycle

Creation resolves an active definition, seeds its icon color and default state unless
the caller provides them, inserts the instance in SQLite, and emits `app.upserted`.
Updates are revision-checked compare-and-swap writes and emit the same event. Deletion
removes the row, emits `app.deleted`, and cleans up every app-owned worker; ordinary
sessions remain independent unless the app explicitly deletes them. SQLite also
removes shares involving the deleted instance, and the same event removes them from
connected clients.

Definitions declare the MIME types their instances accept. `shareWithApp` validates
that capability, persists the immutable share, and emits `app.share.created`;
`consumeAppShare` is scoped to the receiving instance and emits `app.share.deleted`.
Shares use the ordinary workspace snapshot and event stream, so a receiving app can
be closed when context is shared with it.

Instances and definitions appear in the ordinary workspace snapshot. Their
at-most-once events keep connected clients current, while snapshot refetch repairs
missed events. Definition-sensitive transitions are serialized by definition ID;
ordinary instance updates remain independently optimistic.

## Compilation and SDK boundary

An app definition exports one React TSX component. Registration and the first bundle
load after a restart use the same typecheck-and-compile pipeline, caching the browser
bundle under its content-derived revision. `server/compiler/typecheck.ts` checks the
authored file against only the declared runtime dependencies. It owns the TypeScript
program and a definition-local virtual `@toy-box/sdk` module whose `useApp()` state
type is inferred from the manifest by `json-schema-to-ts`.

The public SDK is a feature-owned port, not a separately executing package:
`sdk.ts` declares what authored code may import, the compiler virtualizes that module,
and `components/runtime/sdk/` supplies its browser implementation. The host checks
that implementation against the public contract before exposing it to compiled apps.
`runtime.ts` is the single dependency catalog used by both the compiler allowlist and
the browser bridge. Development compilation reads declarations from the repository;
`cli/build.ts` follows the exact transitive declaration graph rooted at `sdk.ts` and
stages it as a Bun executable asset for standalone compilation.

Static Tailwind classes use the shared Toy Box theme; custom CSS may live in a scoped
`<style>` element. Authored code may import `react`, `zod`, `@toy-box/sdk`, and the
curated `lucide-react` exports. Apps are trusted installed code running in Toy Box's
page, not a security sandbox; the import allowlist makes the contract narrow and
portable.

The SDK exposes:

- `useApp`, which provides the mounted instance, pending shares, schema-validated
  durable state and updates, and host actions. State writes are optimistic,
  debounced, serialized, conflict-replayed, and rolled back on failure.
- `useWorkspace(selector)`, which projects ordinary sessions and child-session
  trees, saved apps, models, published panes, and workers owned by the app.
- `useFile`, which reuses the live file lifecycle from editor panes, including
  queued saves, external updates, modes, and file-owned workers.
- Actions that compose ordinary session, worker, file, and pane capabilities.
- Host-aware layout, feedback, session-toggle, model, file, location, and share
  components. React state owns their ephemeral interaction state.

`AppPane` owns the mounted lifetime. Its `host/` modules bind durable state,
workspace projections, actions, and bundle execution to Toy Box; its `runtime/`
modules contain only what compiled author code can consume. The app-state store is
intentionally imperative because it owns a debounced optimistic write, serialized
conflict replay, and rollback lifecycle. Ordinary app list and bundle reads use
`appQueries`; discrete app operations use `appMutations`.

## Invariants

- Every installed definition follows the same editable and uninstallable disk
  lifecycle, and no ID namespace is reserved.
- Definitions and instances remain separate authorities and lifecycles.
- App state is JSON capped at 64 KiB, never a transcript or file-content store.
- One manifest state contract drives the default, runtime validation, compiler
  typing, and agent introspection; authored TSX never restates that contract.
- Apps reuse ordinary sessions, files, workers, panes, workspace state, and events.
- Shares transfer MIME-typed JSON content; only sessions execute messages.
- Deleting an instance cleans up all of its app-owned workers.
- Breaking author-API changes require a new runtime module contract.

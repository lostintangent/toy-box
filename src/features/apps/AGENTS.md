# Apps

Apps are trusted React surfaces with two ownership models:

- An artifact app is an ordinary session-owned `.toy` file. Its source is the
  durable value; it has no manifest, registration, instance, durable app state,
  pending shares, or app-owned workers.
- An installed app is a durable, reopenable workspace surface backed by three
  feature-owned values. An `AppDefinition` is installed code, metadata, and a
  state contract with its default. Every definition is an ordinary
  `~/.toy-box/apps/<id>/app.json` and `app.tsx` pair.
- An `AppInstance` is one saved use of a definition. SQLite owns its ID, title,
  icon color, small JSON state, optimistic revision, and timestamps.
- An `AppShare` is immutable, MIME-typed JSON content an app surface has offered
  to a saved instance. SQLite retains it until the receiving instance consumes it;
  its nullable source instance is provenance, not ownership. Sharing does not
  execute app code or turn an app into a session.

The feature is organized by responsibility:

- `model/` owns schemas and domain values shared across the boundary.
- `queries.ts` and `mutations.ts` are the browser's declarative access to
  compiled bundles, saved-app reads, and saved-app operations.
- `components/` owns the Apps sidebar and workspace pane. Its private `host/`
  modules adapt Toy Box capabilities to a mounted app; `runtime/` implements the
  authored SDK in the browser.
- `sdk.ts` is the complete public authoring contract for `@toy-box/sdk`, while
  `runtime.ts` defines the versioned compiler-to-host module bridge.
- `server/functions.ts` is the validated RPC ingress. `server/index.ts` owns
  bundle access and installed lifecycle orchestration over the definition registry,
  SQLite store, compiler, and Gist installer. Agent tools and authoring guidance
  live beside those server capabilities in `server/tools.ts` and `server/skills/`.

## Artifact app lifecycle

A `.toy` file remains a `SessionFile` throughout its life. Session event
projection discovers it, ordinary pane derivation gives it an editor pane, and
the file lifecycle supplies its current revision. Only session files select the
artifact renderer; a machine file with the same extension is never executed.
Multiple artifact apps require no registry because file identity already includes
the owning session and relative path.

The artifact bundle endpoint always reads the current file. Compilation uses the
installed-app pipeline without saved-instance state capabilities and with a
file-derived CSS scope, caches only the current source for each file, and drops a
failed candidate so a repair can compile immediately. No artifact app enters
SQLite, the definition registry, the workspace snapshot, or app lifecycle events.
`validate_artifact_app` invokes this same path for the calling session without
registering anything.

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
sessions remain independent unless the app explicitly deletes them. Deleting a
share target removes its pending shares; deleting a saved source clears only their
optional provenance. The same event applies that transition to connected clients.

Definitions declare the MIME types their instances accept. `shareWithApp` validates
that capability and any saved source provenance, persists the immutable target-owned
share, and emits `app.share.created`;
`consumeAppShare` is scoped to the receiving instance and emits `app.share.deleted`.
Shares use the ordinary workspace snapshot and event stream, so a receiving app can
be closed when context is shared with it.

Instances and definitions appear in the ordinary workspace snapshot. Their
at-most-once events keep connected clients current, while snapshot refetch repairs
missed events. Definition-sensitive transitions are serialized by definition ID;
ordinary instance updates remain independently optimistic.

## Compilation and SDK boundary

Every app source exports one React TSX component. Artifact validation, installed
registration, and the first installed bundle load after a restart use the same
typecheck-and-compile pipeline. `server/compiler/typecheck.ts` checks the authored
file against only the declared runtime dependencies. It owns the TypeScript
program and a source-local virtual `@toy-box/sdk` module. Installed manifests
drive the inferred `useApp()` state type; artifacts expose only portable SDK
capabilities.

The public SDK is a feature-owned port, not a separately executing package:
`sdk.ts` declares what authored code may import, the compiler virtualizes that module,
and `components/runtime/sdk/` supplies its browser implementation. The host checks
that implementation against the public contract before exposing it to compiled apps.
`runtime.ts` is the single dependency catalog used by both the compiler allowlist and
the browser bridge. Development compilation reads declarations from the repository;
`cli/build.ts` follows the exact transitive declaration graph rooted at `sdk.ts` and
stages it as a Bun executable asset for standalone compilation.

Static Tailwind classes use the shared Toy Box theme; custom CSS may live in a scoped
`<style>` element. Authored code may import `react`, `motion/react-m`, `zod`,
`@toy-box/sdk`, and the curated `lucide-react` exports. The host wraps every app in
LazyMotion with `domMax` features and user reduced-motion preferences. Apps are trusted
code running in Toy Box's page, not a security sandbox. Motion's lowercase
element exports are bound to capitalized module-scope component names before JSX so
React Compiler preserves their component identity. The import allowlist makes the
contract narrow and portable.

The SDK exposes:

- `useAppActions`, which provides portable session, file, and pane operations to
  every mounted app.
- `useApp`, which requires a saved instance and adds pending shares,
  schema-validated durable state and updates, and saved-only actions. State writes
  are optimistic, debounced, serialized, conflict-replayed, and rolled back on
  failure.
- `useWorkspace(selector)`, which projects ordinary sessions and child-session
  trees, saved apps, models, published panes, and workers owned by the app.
- `useFile`, which reuses the live file lifecycle from editor panes, including
  queued saves, external updates, modes, and file-owned workers.
- Actions that compose ordinary session, file, and pane capabilities, plus
  saved-only share consumption and app-worker operations.
- Host-aware layout, feedback, session-toggle, model, file, location, and share
  components. React state owns their ephemeral interaction state.

`AppHost` owns the common mounted lifetime: workspace projection, portable
actions, linked-pane retention, bundle execution, and cleanup. `panes/AppPane`
supplies saved-instance state and worker capabilities; `panes/ArtifactAppPane`
supplies only its editor pane identity. The `host/` context represents saved
capabilities as one optional unit, so artifact apps cannot receive a fabricated
partial instance.
Its `runtime/` modules contain only what compiled author code can consume. The
app-state store is intentionally imperative because it owns a debounced
optimistic write, serialized conflict replay, and rollback lifecycle. Ordinary
app and bundle reads use `appQueries`; discrete saved-app operations use
`appMutations`.

## Invariants

- Every installed definition follows the same editable and uninstallable disk
  lifecycle, and no ID namespace is reserved.
- Every artifact app remains one session file and one editor pane; it creates no
  registration, instance, or workspace projection.
- Definitions and instances remain separate authorities and lifecycles.
- App state is JSON capped at 64 KiB, never a transcript or file-content store.
- One manifest state contract drives the default, runtime validation, compiler
  typing, and agent introspection; authored TSX never restates that contract.
- Both app kinds reuse ordinary sessions, files, panes, workspace state, and
  events; only a saved instance may own pending shares or app workers.
- Shares transfer MIME-typed JSON content; only sessions execute messages.
- Deleting an instance cleans up all of its app-owned workers.
- Breaking author-API changes require a new runtime module contract.

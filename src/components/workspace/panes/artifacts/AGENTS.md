# Artifact Surfaces

Artifacts turn files produced by agent work into live, editable workspace surfaces. Agent changes appear without reopening the file, user edits persist back to disk, and shared session artifacts notify the agent so iteration can continue in either direction. This folder owns artifact presentation; the read, write, watch, path, and workspace collaborators form the same end-to-end subsystem.

## Domain model

An artifact is a durable file addressed by its source session ID and relative path. The file on disk is the source of truth; Toy Box does not copy its content into pane or shared workspace state.

- Ordinary session artifacts resolve beneath that session's durable files directory.
- An Inbox entry and its managed session share one ID, so the server derives Inbox storage from the entry and keeps the relative path equal to its artifact filename.

Clients never encode physical storage. Read, write, watch, serve, and worker operations all carry the same `{ sessionId, path }` address, and one server resolver selects the owned root.

The pane carries one of three modes: `read`, `edit`, or `shared`. Read keeps artifact content presentation-only while still allowing Markdown comments. Edit persists user changes without agent notification. Shared persists changes and notifies the owning session's agent. Inbox artifacts open in shared mode, and follow-up conversation uses the managed session overlay.

A canvas is not an artifact. It is an SDK-provided URL surface with its own identity and revision, so it does not participate in file read, write, watch, serve, or edit-notification behavior.

## File operations

Artifacts expose four operations with distinct transport needs:

| Operation | Contract                                                                                |
| --------- | --------------------------------------------------------------------------------------- |
| Read      | Validated RPC returns UTF-8 content and modification time                               |
| Write     | Validated RPC persists UTF-8 content and returns the new modification time              |
| Watch     | `/api/watch/<sessionId>/<path>` emits external modification or deletion events over SSE |
| Serve     | `/api/serve/<sessionId>/<path>` returns raw bytes for browser-native relative resources |

One resolver maps the source session and relative path to an allowed file for every operation. An authoritative Inbox row selects Inbox storage; every other session resolves through its durable files directory.

`useArtifact` owns one session-and-path lifetime. It reads initial content, watches external changes, serializes writes so rapid edits cannot land out of order, ignores the watch echo of its own save, and flushes pending edits before unmount. Pane identity is keyed by session and path, so changing either remounts the complete file lifecycle while mode changes preserve it.

Shared edits schedule a debounced `artifact_edited` notification through the ordinary session delivery path. The file is written first; the notification is a side channel that tells the agent to reread durable state, not a second copy of the content.

## Background collaboration

`ArtifactPane` gives every renderer the same `{ pendingWorkers, spawnWorker }` contract. It closes over the artifact address, flushes pending editor changes, and sends a renderer-authored prompt plus an optional friendly name and opaque metadata through a short RPC. Workspace state projects pending workers back to connected clients by artifact address; renderers interpret their own metadata without teaching the host another workflow. This association remains process-local because it can exist while work is queued, before a worker session exists; it should become durable only if artifact admission itself gains restart recovery.

Workers for one resolved artifact execute in order, while different artifacts can progress independently. The artifact layer owns this admission policy and its started/finished projection. Removing a queued association makes its eventual queue slot a no-op; cancelling admitted work delegates to the runtime's race-safe `stopWorker` operation. The runtime's general worker supervisor owns parent model and context inheritance, exact completion, stopping, and retention-aware registry deletion. Artifact workers accept its disposable default, stay out of Inbox and the normal session list, and disappear after finishing; a startup sweep deletes disposable workers abandoned by a process restart. Source deletion finishes outstanding associations and recursively tears down its worker tree. The watched artifact remains the durable result.

Markdown layers inline comments on this primitive. Comment additions, edits, and deletions persist without sending `artifact_edited` notifications; new comments and replies additionally spawn a worker. Its renderer authors the complete Documint response prompt, supplies a friendly worker name, and records only the stable thread ID as worker metadata. That metadata becomes anchored presence while the worker is pending; the worker changes the body, replies in the persisted thread, or does both according to the comment. Custom kinds use the same capability through `Toybox.spawnWorker({ name?, prompt, metadata? })` and receive their pending worker list in the idempotent `onRender` context.

The pane, rather than an individual renderer, owns worker inspection and cancellation. While associations are pending, it declares a worker count through `PaneStatus`; the session overlay declares its trigger into that same host-owned slot, while save and artifact-mode controls use `PaneActions`. The desktop grid presents status as lower-right overlay controls, while pagers place it in their header. `WorkspacePaneView` scopes both slots around the leaf pane and overlay, so neither receives or positions DOM targets. The compact worker menu lists friendly names and status icons. A running worker can open the existing passive `SessionPreview`; queued entries remain visible before their SDK sessions exist. Each entry can stop running work or discard queued work through the pane-owned artifact address. This keeps session IDs, preview placement, cancellation, and read semantics out of custom iframe APIs.

Pending describes worker lifecycle, not whether every intermediate file effect is still absent. A worker can persist its substantive result before its session finishes. Renderers that use placeholders for expected durable content must therefore encode a target identity or baseline in metadata and reconcile it against current content, while presence-style indicators may intentionally remain until the worker finishes.

## Rendering

`ArtifactPane` composes loading, saving, error presentation, actions, and the renderer selected for the file extension.

- Markdown renders from its text content and supports direct editing.
- HTML and SVG render in a sandboxed iframe. A generated serve base lets relative scripts, styles, images, and links resolve within the source session's artifact storage.
- Custom artifact kinds provide a persisted HTML viewer template for claimed extensions. Built-in kinds keep priority, and unclaimed extensions fall back to Markdown.

Custom kind definitions live under `~/.toy-box/artifacts/` and hydrate through shared workspace state. Registration publishes the new definition so connected clients can resolve the renderer immediately. The viewer receives file content and pending workers through the Toy Box bridge, can spawn artifact-scoped workers, and can emit replacement content only when the kind is editable.

## Workspace integration

Session events add artifact paths to reduced session state. Workspace pane derivation turns those paths into linked artifact panes while keeping pane identity and edit mode stable across session updates. Eligible artifacts can take focus when they first appear, but presentation policy remains separate from file state.

Inbox entries store at most one artifact filename and own its directory. `InboxPane` can publish one selected Inbox artifact into its grid or pager, passing the entry ID and filename to the ordinary artifact pane. Selecting the same row unlinks it and selecting another replaces it. Because the managed source session is not a sibling pane, the host supplies `SessionOverlay` so follow-up work uses the history that produced the artifact without exposing a separate session-management burden.

## Boundaries and invariants

- [`../../AGENTS.md`](../../AGENTS.md) owns the pane model and the layouts and workflows that compose artifact surfaces.
- [`../../../../hooks/artifacts/useArtifact.ts`](../../../../hooks/artifacts/useArtifact.ts) owns client file lifecycle; `ArtifactPane` composes session-owned operations, and renderers own format-specific editing and interaction.
- [`../../../../functions/artifacts.ts`](../../../../functions/artifacts.ts) owns validated text read, write, and artifact-worker requests. Watch and serve routes exist because browser-native streaming and relative-resource loading need HTTP transports.
- [`../../../../functions/state/AGENTS.md`](../../../../functions/state/AGENTS.md) owns Inbox rows, custom kind persistence, and artifact-file teardown.
- [`../../../../functions/sdk/AGENTS.md`](../../../../functions/sdk/AGENTS.md) owns projecting agent file activity into artifact events and encoding edit notifications across SDK history.
- Keep one file as the source of truth, one server path resolver for every operation, and one `useArtifact` lifecycle per mounted pane.

# Artifact Surfaces

Artifacts turn files produced by agent work into live, editable workspace surfaces. Agent changes appear without reopening the file, user edits persist back to disk, and shared session artifacts notify the agent so iteration can continue in either direction. This folder owns artifact presentation; the read, write, watch, path, and workspace collaborators form the same end-to-end subsystem.

## Domain model

An artifact is a durable file addressed by its source session ID and relative path. The file on disk is the source of truth; Toy Box does not copy its content into pane or shared workspace state.

- Ordinary session artifacts resolve beneath that session's durable files directory.
- An Inbox entry and its managed session share one ID, so the server derives Inbox storage from the entry and keeps the relative path equal to its artifact filename.

Clients never encode physical storage. Read, write, watch, serve, and comment work all carry the same `{ sessionId, path }` address, and one server resolver selects the owned root.

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

## Inline collaboration

Every new Markdown comment and reply starts a focused response without requiring a Copilot mention. `ArtifactPane` closes over the artifact address, flushes pending editor changes, and enqueues the response through a short RPC. Workspace state links the responding child session to the artifact address and stable Documint thread anchor, so connected and reloading clients project the same anchored presence without adding host-authored status text.

Comment sessions for one resolved artifact run in order, while different artifacts can progress independently. Each child inherits the source session's model and working context, edits the same file, and either changes the body, replies in the thread, or does both according to the comment. This reuses child-session execution without introducing an artifact-job type. The child stays out of Inbox and the normal session list and is deleted when it finishes; its workspace link is removed at the same boundary. Source deletion removes outstanding links and catches created children through ordinary child-session teardown. The watched artifact and persisted comment thread remain the durable result.

## Rendering

`ArtifactPane` composes loading, saving, error presentation, actions, and the renderer selected for the file extension.

- Markdown renders from its text content and supports direct editing.
- HTML and SVG render in a sandboxed iframe. A generated serve base lets relative scripts, styles, images, and links resolve within the source session's artifact storage.
- Custom artifact kinds provide a persisted HTML viewer template for claimed extensions. Built-in kinds keep priority, and unclaimed extensions fall back to Markdown.

Custom kind definitions live under `~/.toy-box/artifacts/` and hydrate through shared workspace state. Registration publishes the new definition so connected clients can resolve the renderer immediately. The viewer receives file content through the Toy Box bridge and can emit replacement content only when the kind is editable.

## Workspace integration

Session events add artifact paths to reduced session state. Workspace pane derivation turns those paths into linked artifact panes while keeping pane identity and edit mode stable across session updates. Eligible artifacts can take focus when they first appear, but presentation policy remains separate from file state.

Inbox entries store at most one artifact filename and own its directory. `InboxPane` can publish one selected Inbox artifact into its grid or pager, passing the entry ID and filename to the ordinary artifact pane. Selecting the same row unlinks it and selecting another replaces it. Because the managed source session is not a sibling pane, the host supplies `SessionOverlay` so follow-up work uses the history that produced the artifact without exposing a separate session-management burden.

## Boundaries and invariants

- [`../../AGENTS.md`](../../AGENTS.md) owns the pane model and the layouts and workflows that compose artifact surfaces.
- [`../../../../hooks/artifacts/useArtifact.ts`](../../../../hooks/artifacts/useArtifact.ts) owns client file lifecycle; `ArtifactPane` composes session-owned operations, and renderers own format-specific editing and interaction.
- [`../../../../functions/artifacts.ts`](../../../../functions/artifacts.ts) owns validated text read, write, and inline-comment response. Watch and serve routes exist because browser-native streaming and relative-resource loading need HTTP transports.
- [`../../../../functions/state/AGENTS.md`](../../../../functions/state/AGENTS.md) owns Inbox rows, custom kind persistence, and artifact-file teardown.
- [`../../../../functions/sdk/AGENTS.md`](../../../../functions/sdk/AGENTS.md) owns projecting agent file activity into artifact events and encoding edit notifications across SDK history.
- Keep one file as the source of truth, one server path resolver for every operation, and one `useArtifact` lifecycle per mounted pane.

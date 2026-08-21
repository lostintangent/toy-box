# Files

Files are browsable workspace resources that become live, editable surfaces. Agent changes appear without reopening a file, user edits persist back to disk, and edits to a shared file notify its owning agent so iteration continues in either direction. This feature owns file identity, validated filesystem operations, Query access, synchronization, browsing, and editor presentation.

## Domain model

An editor addresses one `WorkspaceFile` — either a `session` file (an _artifact_: a path beneath a session's own files directory) or a `machine` file (an absolute path on the host that the agent opened via `open_file`). The file on disk is the source of truth; Toy Box does not copy its content into pane or shared workspace state.

- Session files (artifacts) resolve beneath that session's durable files directory. An Inbox entry and its managed session share one ID, so its artifact resolves as that session's file.
- Machine files resolve to their own absolute path.

Clients never encode physical storage. Read, write, watch, serve, and worker operations all carry the same `WorkspaceFile` address, and one server resolver (`resolveWorkspaceFile`) selects the absolute path.

The pane carries one of three modes: `read`, `edit`, or `shared`. Read keeps content presentation-only while still allowing Markdown comments. Edit persists user changes without agent notification. Shared persists changes and notifies the owning session's agent. Ordinary session files open in edit mode, automation files open in read mode, and Inbox files open in shared mode with follow-up conversation through the managed session overlay.

An SDK canvas is not an editor pane. It is an SDK-provided URL surface with its own identity and revision, so it does not participate in file read, write, watch, serve, or edit-notification behavior. The built-in SVG drawing surface is distinct: its standard `.svg` file is an ordinary editable file and uses the full file lifecycle.

## File operations

A file exposes six operations with distinct transport needs:

| Operation | Contract                                                                            |
| --------- | ----------------------------------------------------------------------------------- |
| Browse    | Validated RPC returns one directory's immediate children                            |
| Create    | Validated RPC exclusively creates an empty machine file                             |
| Read      | Validated RPC returns UTF-8 content and modification time                           |
| Write     | Validated RPC persists UTF-8 content and returns the new modification time          |
| Watch     | `/api/watch/<scope>/<path>` emits external modification or deletion events over SSE |
| Serve     | `/api/serve/<scope>/<path>` returns raw bytes for browser-native relative resources |

The route scope is a session id for an artifact or the literal `machine` for a host file. One resolver (`resolveWorkspaceFile`) maps that `WorkspaceFile` to an allowed absolute path for every operation: a session file resolves beneath its durable files directory; a machine file resolves to its own absolute path.

`queries.ts` defines canonical browse and file-snapshot identity. `mutations.ts` defines creation and per-file serialized writes. `useFile` owns one file's lifetime for editor panes and app file surfaces: it reads initial content, watches external changes, debounces saves, and submits them through the write mutation. It ignores the watch echo of its own save and flushes pending edits before unmount. Pane identity is keyed by the file's identity (`workspaceFileId`), so opening a different file remounts the complete lifecycle while mode changes preserve it.

The file-mode browser can optionally restrict selection and creation by extension. It can create an empty machine file in any visible directory and returns its absolute path through the same completion callback used to select an existing file. Creation is exclusive, so an existing entry is never replaced; once selected, the new file enters the ordinary `WorkspaceFile` lifecycle above.

Shared edits schedule a debounced `file_edited` notification through the ordinary session delivery path. The file is written first; the notification is a side channel that tells the agent to reread durable state, not a second copy of the content.

## Background collaboration

`EditorPane` gives every renderer pending workers plus an optional `spawnWorker` capability for session files. It closes over the file address, flushes pending editor changes, and sends a renderer-authored prompt plus an optional friendly name and opaque metadata through a short RPC. Workspace state projects pending workers back to connected clients by file address; renderers interpret their own metadata without teaching the host another workflow. This association remains process-local because it is published before the worker session runtime exists; it should become durable only if file admission itself gains restart recovery.

An accepted spawn reconciles the workspace snapshot before resolving, so a renderer's local mutation state hands off directly to the authoritative worker projection.

Workers for one resolved file can progress concurrently. The watched file remains their shared source of truth: each worker must reread it immediately before every write and merge its intended change around intervening edits. The [Workers feature](../workers/AGENTS.md) owns this admission policy and its started/finished projection; cancelling admitted work delegates to its race-safe supervisor without affecting siblings. Consumers may monitor the worker through the general session-completion API and receive its final assistant response, but ephemeral completion is not retained as history. File workers are always ephemeral, stay out of Inbox and the normal session list, and disappear after finishing; a startup sweep deletes ephemeral workers abandoned by a process restart. Source deletion finishes outstanding associations and recursively tears down its worker tree. The watched file remains the durable result.

Markdown layers inline comments on this primitive. Comment additions, edits, and deletions persist without sending `file_edited` notifications; new comments and replies additionally spawn a worker. Its renderer authors the complete Documint response prompt, supplies a friendly worker name, and records only the stable thread ID as worker metadata. That metadata becomes anchored presence while the worker is pending; the worker changes the body, replies in the persisted thread, or does both according to the comment. Custom editors use the same capability through `Toybox.spawnWorker({ name?, prompt, metadata? })` and receive their pending worker list in the idempotent `onRender` context.

The pane, rather than an individual renderer, owns worker inspection and cancellation. While associations are pending, it declares a worker count through `PaneStatus`; the session overlay declares its trigger into that same host-owned slot, while save and editor-mode controls use `PaneActions`. The desktop grid presents status as lower-right overlay controls, while pagers place it in their header. `WorkspacePaneView` scopes both slots around the leaf pane and overlay, so neither receives or positions DOM targets. The compact worker menu lists friendly names and status icons. A running worker can open the existing passive `SessionPreview`; starting entries remain visible before their SDK sessions exist. Each entry can cancel starting or running work through the pane-owned file address. This keeps session IDs, preview placement, cancellation, and read semantics out of custom iframe APIs.

Pending describes worker lifecycle, not whether every intermediate file effect is still absent. A worker can persist its substantive result before its session finishes. Renderers that use placeholders for expected durable content must therefore encode a target identity or baseline in metadata and reconcile it against current content, while presence-style indicators may intentionally remain until the worker finishes.

## Rendering

`EditorPane` composes loading, saving, error presentation, actions, and the renderer selected for the file extension.

- Markdown renders from its text content and supports direct editing.
- HTML renders in a sandboxed iframe. A generated serve base lets relative scripts, styles, images, and links resolve within the source session's file storage.
- SVG renders as a sanitized inline SVG DOM drawing surface. Standard SVG content persists; the background follows the user's theme, while selection chrome, history, viewport, active tool, and the dot grid remain client-local interaction state.
- Intent files render as strict task-defined review forms rather than one prescribed specification shape. A concise title is the only required opening; prose appears only when it improves the task's reading. Prose, list, records, native sequence, exact-detail exhibit, workflow, inline map, and grouped subsection primitives compose one top-to-bottom document. Records share one data model across persisted table and cards views. Maps project shared entities and relationships where topology clarifies the story. A requested sequence owns first-class delivery work entities and derives compact numbered steps or genuine parallel phases from implementation dependencies; meaningful phases may become named stages whose membership must match that graph, but stages are not graph entities. Checkpoint comparison remains editor-owned header chrome rather than authored content. Contextual inspection supports stable-identity editing and exposes values, provenance, explanation, and connected entities. Effective changed records and exhibits plus decided choices define implementation obligations; prose and lists remain authoritative guidance without a second per-section truth flag. Settled intent can start directly without a sequence; authoring one opts into complete obligation coverage and dependency-ordered execution.
- A session `.toy` file compiles as a stateless artifact app and mounts through the shared app runtime. It remains an editor pane and file-owned artifact; machine `.toy` files never execute.
- Custom editors provide a persisted HTML viewer template for claimed extensions. Built-in editors keep priority, and unclaimed extensions fall back to Markdown.

Format-owned built-in renderers live in their own kind directories; `.toy`
delegates to the Apps feature that owns its compiler and runtime. See the
[SVG editor guide](components/editor/kinds/svg/AGENTS.md) for the drawing
surface's native-document model, editor lifecycle, and interaction boundaries.

Custom editor definitions live under `~/.toy-box/editors/` and hydrate through shared workspace state. Registration publishes the new definition so connected clients can resolve the renderer immediately. The viewer receives file content, its external revision, and pending workers through the Toy Box bridge, can spawn workers, and can emit replacement content only when the kind is editable. Own edits do not advance the external revision, allowing the viewer to retain its editing buffer while context-only renders update worker presence or editability.

## Workspace integration

Session events add artifact paths to reduced session state. Workspace pane derivation turns those paths — and machine files the agent opened — into linked editor panes while keeping pane identity and edit mode stable across session updates. Eligible files can take focus when they first appear, but presentation policy remains separate from file state.

Inbox entries store at most one artifact filename and own its directory. `InboxPane` can publish one selected Inbox artifact into its grid or pager, passing the entry ID and filename to the ordinary editor pane. Selecting the same row unlinks it and selecting another replaces it. Because the managed source session is not a sibling pane, the host supplies `SessionOverlay` so follow-up work uses the history that produced the artifact without exposing a separate session-management burden.

## Boundaries and invariants

- [`../../workspace/AGENTS.md`](../../workspace/AGENTS.md) owns the pane model and the layouts and workflows that compose editor surfaces.
- [`useFile.ts`](useFile.ts) owns client file lifecycle; [`components/editor/EditorPane.tsx`](components/editor/EditorPane.tsx) dispatches to format-specific renderers.
- [`server/functions.ts`](server/functions.ts) owns validated filesystem RPC ingress, while the rest of `server/` owns operations and path resolution. `routes/` owns the watch and serve HTTP adapters because browser-native streaming and relative-resource loading need those transports.
- [`../inbox/AGENTS.md`](../inbox/AGENTS.md) owns Inbox rows and result lifecycle. This feature owns custom-editor definitions, persistence, and registration; [Sessions](../sessions/AGENTS.md) owns session-file teardown.
- The [Sessions SDK boundary](../sessions/server/sdk/AGENTS.md) owns projecting agent file activity into events and encoding edit notifications across SDK history; [`server/tools.ts`](server/tools.ts) owns file-specific agent ingress.
- Keep one file as the source of truth, one server path resolver for every operation, and one `useFile` lifecycle per mounted pane.

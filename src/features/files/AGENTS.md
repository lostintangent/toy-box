# Files

Files are browsable workspace resources that become live, editable surfaces. Agent changes appear without reopening a file, user edits persist back to disk, and edits to a shared file notify its owning agent so iteration continues in either direction. This feature owns file identity, validated filesystem operations, Query access, synchronization, browsing, and editor presentation.

## Domain model

An editor addresses one `WorkspaceFile`, whose `kind` is either `session` (an _artifact_: a path beneath a session's own artifacts directory) or `machine` (an absolute path on the host that the agent opened via `open_file`). The file on disk is the source of truth; Toy Box does not copy its content into pane or shared workspace state.

- Session files (artifacts) resolve beneath that session's durable artifacts directory. An Inbox entry and its managed session share one ID, so its artifact resolves as that session's file.
- Machine files resolve to their own absolute path.

Clients never encode physical storage. Read, write, watch, serve, and worker operations all carry the same `WorkspaceFile` address, and one server resolver (`resolveWorkspaceFile`) selects the absolute path.
When an Agent shares an absolute path with a Channel, Files performs the inverse classification once
so a path beneath Session storage remains a Session file rather than becoming a machine file.
Shared tool projection derives that same identity from successful `open_file` / `close_file`
calls' recorded path arguments; their results only acknowledge success.

The pane carries one of three modes: `read`, `edit`, or `shared`. Read keeps content presentation-only while still allowing Markdown comments. Edit persists user changes without notifying the agent. Shared persists changes and notifies the owning session's agent. Ordinary session files open in edit mode, automation files open in read mode, and Inbox files open in shared mode with follow-up conversation through the managed session overlay.

An SDK canvas is not an editor pane. It is an SDK-provided URL surface with its own identity and revision, so it does not participate in file read, write, watch, serve, or edit-message behavior. The built-in SVG drawing surface is distinct: its standard `.svg` file is an ordinary editable file and uses the full file lifecycle.

## File operations

A file exposes seven operations with distinct transport needs:

| Operation | Contract                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------- |
| Browse    | Validated RPC returns one directory's immediate children                                          |
| Search    | Validated RPC ranks a directory's files, honoring Git ignores, for `#` completions                |
| Create    | Validated RPC exclusively creates an empty machine file                                           |
| Read      | Validated RPC returns UTF-8 content, null when the file isn't text, and modification time         |
| Write     | Validated RPC persists UTF-8 content and returns the new modification time                        |
| Watch     | Validated RPC leases a file to the tab's workspace connection; changes arrive as workspace events |
| Serve     | `/api/serve/<scope>/<path>` returns raw bytes or media ranges for browser URLs                    |

The session composer's `#` picker turns a search result into an atomic `[Name](file:PATH)`
reference using the shared `[label](kind:target)` codec. Sessions interprets its `file` kind.
The label is a basename; the encoded
target retains the complete returned path. This is presentation over ordinary message text,
not another workspace file identity or file-loading path.

The route scope is a session id for an artifact or the literal `machine` for a host file. One resolver (`resolveWorkspaceFile`) maps that `WorkspaceFile` to an allowed absolute path for every operation: a session file resolves beneath its durable artifacts directory; a machine file resolves to its own absolute path.
Serve responses are privately cached and revalidated from file metadata, so unchanged resources reuse browser-cached bytes without hiding edits.
A read decides whether a file is text: a NUL in its first 8,000 bytes (Git's rule) or bytes that aren't UTF-8 make its content null. A file with a NUL is never read past those bytes, and no surface can save lossy text over a file that isn't text.

`server/watcher.ts` owns shared filesystem observation. One server-lifetime recursive watcher
covers all session artifacts and serves both artifact discovery and open files. Machine files
outside that tree share one on-demand watcher per parent directory, released when no file in it is
watched; watching the parent follows atomic file replacement. A watched file is held by leases,
counted per `WorkspaceFile` address, so any number of tabs watching it still yields one
`file.changed` or `file.deleted` workspace event per change; those events are simply what the
watcher reports about the files it holds. `watchFile` adds a lease and attaches it to the tab's
workspace connection, so unmounting releases it through Workspace's `releaseLease` and closing the
tab releases it with the connection. It replies with the file's current state so a write between
the initial read and the watch is still observed. File changes are
at-most-once hints like every other workspace event: [`cache.ts`](cache.ts) rereads only the file
whose query a change names, and only when its timestamp is news to that tab.

`queries.ts` defines canonical browse, search, and file-snapshot identity; the Session
file-completion source projects search results into references. `mutations.ts` defines creation and per-file serialized writes. `useFile` owns one file's lifetime for editor panes and app file surfaces: it reads initial content, watches the file for as long as it is open in the tab, debounces saves, and submits them through the write mutation. A pending edit that a newer external version has replaced is dropped rather than written, so the file keeps matching what the pane shows. A save confirms the tab's cached copy, so its own change notice is no news, and its renderer revision advances only for versions it didn't write: a save never resets the writer's buffer, while any other surface showing the same file picks it up. A renderer that mounts into an open pane, as when another editor kind claims the file, starts from the pane's latest text through `useMountedContent`, including edits not yet saved, and then follows external revisions. It flushes pending edits before unmount. A file that isn't text has null content and the error "This file isn't text.", so it is never ready for a text renderer. Opening any file, such as a machine file from the browser, starts this lifecycle, so it is watched with no other step. Other features open files through [`useRevealFile`](useRevealFile.ts), which brings a file forward in the current surface and opens its editor when it isn't showing, so they never build editor panes themselves. [`OpenFileDialog`](components/browser/OpenFileDialog.tsx) opens what the file browser picks through it, so any feature offers Open a file with `openDialog`. Pane identity is keyed by the file's identity (`workspaceFileId`), so opening a different file remounts the complete lifecycle while mode changes preserve it.

The file-mode browser can optionally restrict selection and creation by extension. It can create an empty machine file in any visible directory and returns it as a machine file through the same completion callback used to select an existing file. Creation is exclusive, so an existing entry is never replaced; once selected, the new file enters the ordinary `WorkspaceFile` lifecycle above.

A shared-mode save asks the write to notify the agent. Once that file's notifying writes pause for 8 seconds, from any tab or pane and whether or not it's still open, the server sends its owning Session one `file_edited` system message through the ordinary Session delivery path. The file is written first; the message tells the agent to reread durable state rather than copying the content.

## Background collaboration

`EditorPane` gives every renderer pending workers plus optional `spawnWorker` capability for session
files. Worker requests carry a renderer-authored prompt plus optional friendly name and opaque
metadata. Workers' active query projects pending workers back to connected clients, and `useFile`
selects those for its file address; renderers interpret their own metadata without teaching the host
another workflow. Worker association remains process-local because it is published before the worker
session runtime exists.

An accepted spawn refreshes Workers' active query before resolving, so a renderer's local mutation state hands off directly to the authoritative worker projection.

Workers for one resolved file can progress concurrently. The watched file remains their shared source of truth: each worker must reread it immediately before every write and merge its intended change around intervening edits. The [Workers feature](../workers/AGENTS.md) owns this admission policy and its started/finished projection; cancelling admitted work delegates to its race-safe supervisor without affecting siblings. Consumers may monitor the worker through the general session-completion API and receive its final assistant response, but ephemeral completion is not retained as history. File workers are always ephemeral, stay out of Inbox and the normal session list, and disappear after finishing; a startup sweep deletes ephemeral workers abandoned by a process restart. Source deletion finishes outstanding associations and recursively tears down its worker tree. The watched file remains the durable result.

Markdown layers inline comments on this primitive. Comment additions, edits, and deletions persist
without sending `file_edited` system messages. Documint exposes the anonymous Assistant, and a new
comment or reply spawns a Worker. The renderer authors the complete
Documint response prompt. The responder changes the body, replies in the persisted thread, or does both
according to the comment; the file stays the public source of truth. An app that opens files uses
the same capability through its opened file's `spawnWorker` and `workers`.

The pane, rather than an individual renderer, owns worker inspection and cancellation. While associations are pending, it declares a worker count through `PaneStatus`; the session overlay declares its trigger into that same host-owned slot, while save and editor-mode controls use `PaneActions`. The desktop grid presents status as lower-right overlay controls, while pagers place it in their header. Workspace's pane shell scopes both slots around the leaf pane and overlay, so neither receives or positions DOM targets. The compact worker menu lists friendly names and status icons. A running worker can open the existing passive `SessionPreview`; starting entries remain visible before their SDK sessions exist. Each entry can cancel starting or running work through the pane-owned file address. This keeps session IDs, preview placement, cancellation, and read semantics out of renderers and apps.

Pending describes worker lifecycle, not whether every intermediate file effect is still absent. A worker can persist its substantive result before its session finishes. Renderers that use placeholders for expected durable content must therefore encode a target identity or baseline in metadata and reconcile it against current content, while presence-style indicators may intentionally remain until the worker finishes.

## Rendering

`EditorPane` composes loading, saving, error presentation, actions, and the renderer selected for the file extension.

- Markdown renders from its text content and supports direct editing.
- HTML renders in a sandboxed iframe. A generated serve base lets relative scripts, styles, images, and links resolve within the source session's file storage.
- SVG files delegate to the [Whiteboard feature](../whiteboard/AGENTS.md). The file-kind adapter supplies content, editability, persistence, relative-resource resolution, and pane actions without owning the native SVG model or editor presentation.
- Brief files delegate to the [Briefs feature](../briefs/AGENTS.md). The file-kind adapter supplies content revisions, persistence, relative-resource resolution, and worker-backed actions without owning the brief model or presentation.
- Images and videos render read-only from the file's serve URL and reload for each external revision. These binary kinds mount without text, while any other kind shows that a file isn't text instead of mounting.
- A session `.toy` file compiles as a stateless artifact app and mounts through the shared app runtime. It remains an editor pane and file-owned artifact; machine `.toy` files never execute.
- An installed app definition renders the extensions its manifest `opens`. Built-in editors keep priority, the first definition in catalog order wins a shared extension, and unclaimed files fall back to the read-only code viewer.
- Any other text file renders read-only as numbered lines, colored by the same highlighter as transcript code, and re-highlights with each external revision.

File-kind adapters live in their own kind directories. `.svg` delegates to the
Whiteboard feature, `.brief` delegates to the Briefs feature, and `.toy` files
and the extensions installed definitions open delegate to the Apps feature that
owns their compiler and runtime.

The registry resolves definitions from the Apps catalog, selecting only its definitions, so connected clients switch renderers as soon as a definition that opens a file is installed or uninstalled, and other app changes don't re-render file surfaces. The app receives this pane's file lifecycle through the SDK's `useOpenedFile()`: content, its external revision, mode, pending workers, saving, and worker spawning. Own edits do not advance the external revision, so the app keeps its editing buffer while worker presence and mode update.

## Workspace integration

Sessions discovers artifact membership from the filesystem. Files observation reports affected session IDs; Sessions reads and publishes the current file list to active sessions through canonical events. Idle snapshots read the current directory. Sessions turns those paths, and machine files the agent opened, into linked editor panes keyed by file, so pane identity stays stable across session updates. An editor's mode is the user's pick for that file in the tab, then any mode its publisher asked for, then the owner's default. `EditorPane` keeps those picks, so no publisher has to carry a mode forward and an editor opened from the URL keeps its mode too. Eligible files can take focus when they first appear, but presentation policy remains separate from file state.

Inbox entries reference at most one existing file beneath their Worker Session's artifacts directory. `InboxPane` publishes an artifact result as a linked editor, or a message/error result as a linked Session, keeping Inbox open. Artifact paths can include subdirectories. Selecting the same row unlinks it and selecting another replaces it. Because the managed source session is not a sibling pane, the host supplies `SessionOverlay` so follow-up work uses the history that produced the artifact without exposing a separate session-management burden.

## Boundaries and invariants

- [`../workspace/AGENTS.md`](../workspace/AGENTS.md) owns the pane model and the layouts and workflows that compose editor surfaces.
- [`useFile.ts`](useFile.ts) owns client file lifecycle; [`components/editor/EditorPane.tsx`](components/editor/EditorPane.tsx) dispatches to format-specific renderers.
- [`components/editor/kinds/svg/SvgEditor.tsx`](components/editor/kinds/svg/SvgEditor.tsx) adapts that lifecycle and [`SvgPaneActions.tsx`](components/editor/kinds/svg/SvgPaneActions.tsx) adapts semantic editor actions to pane chrome for the host-neutral [Whiteboard feature](../whiteboard/AGENTS.md).
- [`components/editor/kinds/brief/BriefEditor.tsx`](components/editor/kinds/brief/BriefEditor.tsx) adapts that lifecycle to the host-neutral [Briefs feature](../briefs/AGENTS.md).
- [`server/functions.ts`](server/functions.ts) owns validated filesystem RPC ingress, while the rest of `server/` owns operations and path resolution. `routes/` owns the serve HTTP adapter because relative-resource loading needs a browser URL.
- [`../inbox/AGENTS.md`](../inbox/AGENTS.md) owns Inbox rows and result lifecycle. [Apps](../apps/AGENTS.md) owns installed definitions, including which extensions they open; [Sessions](../sessions/AGENTS.md) owns session-file teardown.
- The [session provider boundary](../providers/INTEGRATION.md) owns projecting tool activity and encoding system messages across SDK history. Sessions owns filesystem-based artifact discovery; [`server/tools.ts`](server/tools.ts) owns file-specific agent ingress.
- Keep one file as the source of truth, one server path resolver for every operation, and one `useFile` lifecycle per mounted pane.

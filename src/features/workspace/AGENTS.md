# Workspace

Workspace is Toy Box's application composition feature. It owns two sibling capabilities:

- the shared projection and update plane that composes authoritative facts from Sessions, Channels,
  Inbox, Automations, Workers, Files, and Apps without becoming another source of truth;
  and
- the browser-local shell that composes feature-owned panes into the desktop, mobile, and Hyper
  layouts.

The projection has no knowledge of panes or layout. The shell consumes the projection where
cross-feature presentation requires it. Workspace is therefore a high-level feature: sibling
features contribute facts and surfaces, while the main route assembles the product through
Workspace.

Feature components may consume narrow Workspace capabilities such as pane slots and output
presentation; those reusable capabilities remain independent of their consuming features.
`src/shared` remains independent of feature modules.

## Shared projection

`WorkspaceState` is the aggregate read model delivered during SSR and refreshed after reconnects.
It includes settings, sparse session activity, Hyper membership, active workers, custom editors,
and environment capabilities. Feature databases, registries, files, and session history remain
authoritative; Workspace only assembles the shared coordination values.
Sessions, Channels, Automations, Inbox, Apps, and Providers have independent Query catalogs
preloaded by the main route. The session catalog supplies durable ownership for generic session
classification; feature catalogs supply the records needed by their own surfaces.

The snapshot path reads those feature-owned facts once; the event path incrementally maintains the
owning caches. Features publish accepted changes through `server/events.ts`, while
the central pure reducer owns only composition invariants—for example, removing projected
workers when an app disappears. It never performs a feature's persistence or lifecycle work.
General invalidation hints such as `session.touched` remain reducer no-ops and instead prompt the
owning feature cache to recover from its authoritative snapshot.
Inbox owns its list query and handles `inbox.changed` and `inbox.entry.deleted` in its feature cache.
Its entries are absent from `WorkspaceState`; presentation combines the Inbox list with shared
Session activity where needed. The shared stream routes its events without another connection.
Apps owns its definitions, saved instances, and shares in one catalog query; its cache handles
app events and share cleanup. Workspace routes those events and refreshes the catalog on reconnect.
Each server value has one owning cache; cross-feature consumers compose those caches directly.

`disabledProviders` controls model and session discovery, with Claude disabled by default.
Provider availability and pin changes are published after persistence, then invalidate session
catalog membership on every client. Provider changes also invalidate the provider catalog.
Other preferences retain their existing optimistic updates.
`defaultSessionView` seeds each newly opened active session pane, including historical sessions,
without changing the view in already-mounted panes. It defaults to All messages; each pane can
independently switch to Responses without writing the preference.
Sidebar text, provider, and external-session filters are browser-local route state; they do not
write workspace settings or alter open panes.

[`model/state/reducer.ts`](model/state/reducer.ts) applies the same `WorkspaceEvent` transitions on
the server and in each browser. The sparse `sessionStates` map retains only meaningful shared
activity: active work or unread completion. Active work carries `since`, stamped from the `at` of
the event that began the run; waiting and background keep it and a new run restarts it.
Background sessions remain live but do not count as foreground work. Draft sessions live in
the Sessions catalog; ordinary read-idle sessions have no workspace activity entry.

[`model/state/drafts.ts`](model/state/drafts.ts) defines saved drafts: each composer's unsent
text, keyed by its owner (`session:<id>`, `channel:<id>`, or `inbox`). A `draft.changed` action
carries a client's edit; the server stamps it, keeps it in a process-local map for a day after its
last edit, and broadcasts it. Deleting a session or channel drops its draft. A session's draft
marks its sidebar row and keeps it in the catalog. [`hooks/useSavedDraft.ts`](hooks/useSavedDraft.ts)
is the composer-facing hook: it applies edits locally, debounces them out, adopts other clients'
edits but not its own echoes, syncs a cleared draft at once, and flushes on unmount. It returns
the `value` and `onValueChange` a composer draft takes; images stay local to each client.

[`queries.ts`](queries.ts) is the canonical TanStack Query interface to that projection. It owns
snapshot identity, optimistic workspace commands, and a per-`QueryClient` event journal that keeps
an in-flight snapshot from overwriting newer events. [`hooks/state.ts`](hooks/state.ts) exposes
narrow reactive selectors and the two client command hooks; it does not copy server state.

[`hooks/useWorkspaceSync.ts`](hooks/useWorkspaceSync.ts) is the single browser sink for the
at-most-once workspace SSE stream. The root route captures the process-scoped broadcast revision
before its SSR loaders run. The stream's opening message checks that revision without another
request: an unchanged initial connection reuses the hydrated queries, while a mismatch refreshes
the aggregate snapshot and Session, Channel, Automation, Inbox, Apps, and Provider catalogs in the
background. Reconnects always refresh, including after page visibility changes, so native history
changed outside Toy Box is rediscovered. Subsequent events update their owning Query caches. The revision survives HMR,
changes after a server restart, and requires no event buffer. Events announce accepted changes;
they are synchronization hints, not durable truth or a replay log.

[`server/functions.ts`](server/functions.ts) validates remote ingress for hydration, shared
workspace actions, and settings updates, then delegates to the plain operations in
[`server/index.ts`](server/index.ts). That module assembles the cross-feature snapshot and owns
Workspace-level orchestration. [`server/tools.ts`](server/tools.ts) exposes Workspace-owned settings
updates to model sessions. [`server/state/`](server/state) owns only workspace-wide coordination:
sparse shared session activity, Hyper membership, settings, and environment capabilities.
[`server/events.ts`](server/events.ts) owns the process-local fan-out behind the shared
[`routes/api/workspace.ts`](routes/api/workspace.ts) SSE route.
Shared SQLite connection management and schema composition stay in [`../../server/`](../../server), while
each feature owns its schema, records, and lifecycle. Workspace's own `server/state/schema.ts`
defines the durable settings table.

Browser-local pane topology, focus, layout, and client identity are deliberately absent from the
server projection.

## Pane model

`WorkspacePane` is the shared presentation value for seven kinds of content:

- Inbox is the stable fallback when no root pane is selected.
- A session pane is sourced by its own session ID.
- An editor pane presents a session artifact or machine file.
- A canvas pane presents an SDK-provided URL associated with its source session.
- A screen pane presents a native host capability by Screens-owned ID.
  Each visible canvas owns its connection and renderer. Closing a pane
  does not stop the source application.
- An app pane presents one durable app instance and is not inherently session-backed.
- A channel pane presents one durable shared bus. Its artifacts retain their Files-owned identity
  when revealed as ordinary root editor panes rather than published as linked panes.

A session `.toy` artifact app remains an editor pane. Reusing the app compiler
and mounted runtime does not add another pane kind or transfer ownership from its
source file.

Each pane has a stable ID that represents mounted identity. [`model/panes.ts`](model/panes.ts) owns
identity, source relationships, reachability, ordering, and focus policy as pure functions. Root
sessions, files, apps, channels, and screens are deduplicated and capped at four panes. Active session,
Inbox, and app panes can publish linked panes through a browser-local graph owned by their workspace
surface. That graph contains composition only; it never copies transcripts, Channel messages, file
content, Inbox rows, or app state.
Explicit focus can bring an overflow artifact or child into the capped layout by replacing an
unrelated pane while retaining its publishers. Clearing focus restores the ordinary ordering.
Sessions publish only their selected artifact editor, with the full catalog remaining in their tray;
switching artifacts replaces that linked editor rather than filling the layout with every file.

`SessionPane` has three interaction modes:

- `active` is the primary interactive surface and publishes linked panes.
- `overlay` is interactive but secondary, so it does not publish another layer.
- `passive` stays live without accepting input or acknowledging the session as read.

Pane `variant` is a separate host concern. `WorkspacePaneView` maps one pane value to its feature
component and supplies host-owned action and status slots and the presentation variant through one
pane-shell context. Descendants declare controls with `PaneActions` or `PaneStatus` without receiving
DOM targets. This lets the grid and pager hosts
compose identical content for the main, mobile, and Hyper surfaces while preserving each feature's
lifecycle. `PaneViewMenu` reads the host variant from that context and supplies shared view chooser
chrome; Sessions and Channels declare their own view options and own selection and filtering.

## Layouts and compositions

[`components/layout/WorkspaceLayout.tsx`](components/layout/WorkspaceLayout.tsx) owns the responsive
hydration boundary. It preserves both compact and desktop HTML during SSR, then mounts only the
matching client composition. `MobileWorkspaceLayout` owns the compact sidebar, pager, and terminal
overlay; `DesktopWorkspaceLayout` owns desktop placement plus the transient mechanics of its
resizable terminal drawer. Shared workspace state and commands remain in the route composition
root rather than either responsive presentation.

[`components/panes/hosts/WorkspaceGrid.tsx`](components/panes/hosts/WorkspaceGrid.tsx) is the
always-mounted desktop host. It lays out up to four panes, preserves useful sizing as panes change,
and owns maximize and restore behavior.

[`components/panes/hosts/WorkspacePager.tsx`](components/panes/hosts/WorkspacePager.tsx) is the
compact host used by mobile and Hyper. It keeps inactive pages mounted so paging preserves scroll
and local surface state, and portals the active pane's controls into its toolbar.

`components/panes/hosts` owns collection geometry and pane visibility. `components/panes/shell`
owns the single-pane feature adapter and the chrome slots supplied by those hosts. Neither owns the
feature state rendered inside a pane.

[`components/outputs/`](components/outputs/) groups `ComposerTray.tsx`, `ArtifactPill.tsx`,
`ChecklistPopup.tsx`, and `PagePreview.tsx` for Session and Channel output presentation;
`PagePreview` is the sandboxed thumbnail that HTML artifacts and a Channel's preview share. They combine Files identity and
previews with the current surface's pane focus and file-worker activity. Callers supply their
artifacts, checklist, and additional controls.

One sparse browser cookie retains non-default `WorkspaceLayout` values across reloads and SSR.
`sidebarCollapsed` is the shared visibility fact: it produces the desktop rail or reveals the
mobile workspace, whose no-root fallback is Inbox.

[`components/layout/HyperSession.tsx`](components/layout/HyperSession.tsx) is an independent
mini-workspace around a managed session. It has its own roots, focus, and publication graph while
reusing the ordinary pager and pane components. Promotion preserves the transcript and live
runtime while transferring lifecycle management into the normal workspace.

[`../sessions/components/SessionPreview.tsx`](../sessions/components/SessionPreview.tsx)
renders a passive session in a delayed hover popover. [`../sessions/components/SessionOverlay.tsx`](../sessions/components/SessionOverlay.tsx)
is the reusable follow-up surface for session-backed output shown without its source session pane.

## Commands and palette

[`src/shared/commands`](../../shared/commands/) is the generic command mechanism: the `Command`
value, `CommandProvider`, search and usage ranking, and the `CommandButton` and `CommandMenuItem`
adapters. Every button, menu item, shortcut, and palette row runs through `executeCommand`, so a
disabled command never runs and failures surface one way.

A command is defined beside the state it acts on, and its ID names the capability (`files.browse`),
not the module that defines it. [`commands.ts`](commands.ts) defines the workbench's commands for
creating work and showing its surfaces. The main route owns that state, so it provides them through
`CommandProvider`, which binds their shortcuts and supplies them through context to its descendants:
the sidebar, palette, and dialogs reference them by ID during render, so the sidebar's header, rail,
and footer render their command buttons in the server's HTML. Commands scoped to the focused pane,
such as "This session", will need a focus-aware registry rather than more providers. Features build
commands for their own items, such as
[`../sessions/commands.ts`](../sessions/commands.ts) for a session's actions. Commands that open a
shared dialog call `openWorkspaceDialog`, hosted by
[`components/WorkspaceDialogs.tsx`](components/WorkspaceDialogs.tsx).

[`components/palette/`](components/palette/) is the Mod+K palette, a composition over sessions,
channels, apps, automations, files, and the provided commands. The sidebar's Hyper menu also runs
`workspace.search`, which is how touch screens reach it. `palette.ts` is its pure model: a
stack of pages (root, group, an item's actions, and the model, directory, and file pickers), each
with its own query and selection, plus the launch options chosen for new work: a model and a
`SessionLocation`, whose worktree defaults to the workspace's setting. `usePaletteView` builds each page's sections from feature queries
and provided commands, and `CommandPalette` owns the dialog, keyboard, running, and the desktop
peek. Search reads only what a row shows, its title and detail. Matches rank by where the query
occurs, then by frequent use; commands and places rank above
content at a comparable match because their titles lead with a verb. A query that names nothing can
start work with it: "New session" starts headlessly through `sessionMutations.startSession()`, as
Inbox Send does, then opens the running session's pane; "Run in Inbox" dispatches an Inbox task.

## Ownership and extension

- [`router.tsx`](router.tsx) constructs the TanStack Start router, while [`routes.ts`](routes.ts)
  assembles Workspace and feature-owned route modules into the application route tree.
- [`routes/__root.tsx`](routes/__root.tsx) owns the document shell, global presentation providers,
  and initial Workspace hydration. Its stylesheet is co-located in the same route boundary.
- [`routes/index.tsx`](routes/index.tsx) is the main composition root. It derives root panes
  from the URL and supplies shared state and commands to the responsive workspace shell.
- [`hooks/layout/surface.tsx`](hooks/layout/surface.tsx) owns the independent Main and Hyper surface
  stores. [`hooks/layout/panePublications.ts`](hooks/layout/panePublications.ts) owns publication
  transitions and editor display mode.
- [`components/panes/shell/WorkspacePaneView.tsx`](components/panes/shell/WorkspacePaneView.tsx) is
  the single host-to-feature adapter. Feature components own content behavior; Workspace owns
  placement, focus, and chrome.
- [Sessions](../sessions/AGENTS.md), [Channels](../channels/AGENTS.md),
  [Inbox](../inbox/AGENTS.md), [Files](../files/AGENTS.md), and
  [Apps](../apps/AGENTS.md) own the data and behavior rendered in their panes. Channels owns
  its Agent identity and membership UI.
- [Terminal](../terminal/AGENTS.md) owns its PTY and connection lifecycle; the main route
  owns only shared drawer visibility and size, while each responsive layout owns placement and
  transient presentation mechanics.

To add a pane kind, define its stable identity and source relationship, render it once in
`WorkspacePaneView`, and extend ordering or focus policy only when product behavior requires it. To
add a workflow, compose existing panes and choose its host, focus surface, and session interaction
mode. To add a workbench command, define it in `commands.ts` over route state; the palette,
shortcuts, and any `CommandButton` that references its ID pick it up.

Preserve these invariants:

- Feature state remains authoritative; Workspace is an aggregate projection and composition shell.
- Pane IDs describe mounted content identity, and React keys follow them when content must remount.
- Passive previews may stream live work but must not acknowledge it as read.
- Secondary session surfaces must not recursively publish linked panes.
- Pane content publishes through its current surface and must not choose between Main and Hyper.
- Every session-backed output retains its source session so overlays and follow-up stay generic.

# Workspace

Workspace is Toy Box's application composition feature. It owns two sibling capabilities:

- the shared projection and update plane: workspace's own shared facts, plus the update stream
  and sync that carry every feature's events to that feature's caches without Workspace becoming
  another source of truth; and
- the browser-local shell that composes feature-owned panes into the desktop, mobile, and Hyper
  layouts.

The projection has no knowledge of panes or layout. The shell consumes the projection where
cross-feature presentation requires it. Workspace is therefore a high-level feature: sibling
features contribute facts and surfaces, while the main route assembles the product through
Workspace.

Feature components may consume narrow Workspace capabilities such as the synced store, pane model,
and surface; those reusable capabilities never import a feature.
`src/shared` remains independent of feature modules.

## Shared projection

`WorkspaceState` is the aggregate read model delivered during SSR and refreshed after reconnects.
It holds only the facts Workspace owns: settings, drafts, Hyper membership, and environment
capabilities. Every other feature's shared state, including Sessions' activity, Workers' active
workers, and Files' custom editors, lives in that feature's own Query cache.
Sessions, Channels, Automations, Inbox, Apps, Providers, Workers, and Files have independent Query
catalogs preloaded by the main route. The session catalog supplies durable ownership for generic session
classification; feature catalogs supply the records needed by their own surfaces.

The snapshot path reads those feature-owned facts once; the event path incrementally maintains the
owning caches. Each feature declares the events it publishes by augmenting `WorkspaceEvents` in
[`model/events.ts`](model/events.ts) from its own model, publishes them through
`server/events.ts`, and default-exports a `WorkspaceCache` from its `cache.ts` that applies
events to its caches and refreshes them after a gap. A cache that writes an event into a query's
data then calls `replaceOverlappingRead` from [`src/shared/query.ts`](../../shared/query.ts), so a
read already in flight can't overwrite it. A snapshot that every event reduces into, such as
`WorkspaceState` or Sessions' activity, instead reads and applies through that module's
`snapshotJournal`, which reduces the events applied during a read over the snapshot it returns. [`sync.ts`](sync.ts) discovers those
caches by convention, Workspace's own included, so neither the event type nor the client fan-out lists features. Live, optimistic, and confirmed events all go through `applyWorkspaceEvent`, so no caller reaches into a feature's cache directly. Meanwhile,
the central pure reducer owns only Workspace's facts, such as clearing a deleted session's draft and
Hyper membership. It never performs a feature's persistence or lifecycle work.
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

[`model/state/reducer.ts`](model/state/reducer.ts) applies `WorkspaceEvent` transitions to each
browser's workspace state. Whether a session is running, waiting, in the background, or
unread is Sessions' activity, not workspace state; see
[`../sessions/AGENTS.md`](../sessions/AGENTS.md).

[`model/state/drafts.ts`](model/state/drafts.ts) defines saved drafts: each composer's unsent
text, keyed by its owner (`session:<id>`, `channel:<id>`, or `inbox`). A `draft.changed` action
carries a client's edit; the server stamps it, keeps it in a process-local map for a day after its
last edit, and broadcasts it. Deleting a session or channel drops its draft. A session's draft
marks its sidebar row and keeps it in the catalog. [`hooks/useSavedDraft.ts`](hooks/useSavedDraft.ts)
is the composer-facing hook: it applies edits locally, debounces them out, adopts other clients'
edits but not its own echoes, syncs a cleared draft at once, and flushes on unmount. It returns
the `value` and `onValueChange` a composer draft takes; images stay local to each client.

[`queries.ts`](queries.ts) is the canonical TanStack Query interface to that projection. It owns
snapshot identity and reads through a `snapshotJournal`, so an in-flight snapshot never overwrites
newer events. [`cache.ts`](cache.ts) is Workspace's own `WorkspaceCache`: it reduces
each event into the snapshot and refreshes provider and session catalogs when the settings they
depend on change. [`sync.ts`](sync.ts) applies each event to every cache and refreshes them all
after a gap, and [`mutations.ts`](mutations.ts) issues optimistic workspace commands and setting
updates. [`hooks/state.ts`](hooks/state.ts) exposes
narrow reactive selectors and the two client command hooks; it does not copy server state.

[`hooks/useWorkspaceSync.ts`](hooks/useWorkspaceSync.ts) is the single browser sink for the
at-most-once workspace SSE stream. The root route captures the process-scoped broadcast revision
before its SSR loaders run. The stream's opening message checks that revision without another
request: an unchanged initial connection reuses the hydrated queries, while a mismatch refreshes
the aggregate snapshot and every feature's caches in the background. Reconnects always refresh, including after page visibility changes, so native history
changed outside Toy Box is rediscovered. Subsequent events update their owning Query caches. The revision survives HMR,
changes after a server restart, and requires no event buffer. Events announce accepted changes;
they are synchronization hints, not durable truth or a replay log.

Each stream is also the tab's **connection**. Its opening message carries a connection id, which
[`sync.ts`](sync.ts) keeps as `workspaceConnection`. A feature attaches a server resource the tab
holds, such as a Files watch, to that id through [`server/connections.ts`](server/connections.ts)
and hands the tab a lease; the tab ends it early with the `releaseLease` RPC, and otherwise it ends
when the stream does. Reconnecting yields a new id, and holders attach again.

[`server/functions.ts`](server/functions.ts) validates remote ingress for hydration, shared
workspace actions, and settings updates, then delegates to the plain operations in
[`server/state/`](server/state). That module assembles the cross-feature snapshot and owns only
workspace-wide coordination: drafts, Hyper membership, settings, and environment
capabilities. [`server/tools.ts`](server/tools.ts) exposes Workspace-owned settings
updates to model sessions.
[`server/events.ts`](server/events.ts) owns the process-local fan-out behind the shared
[`routes/api/workspace.ts`](routes/api/workspace.ts) SSE route.
Shared SQLite connection management and schema composition stay in [`../../server/`](../../server), while
each feature owns its schema, records, and lifecycle. Workspace's own `server/schema.ts`
defines the durable settings table.

Browser-local pane topology, focus, layout, and client identity are deliberately absent from the
server projection.

## Pane model

`WorkspacePane` is the shared presentation value for content in a workspace surface. Each feature
owns its pane kinds: its model augments the open `WorkspacePanes` interface in
[`model/panes.ts`](model/panes.ts) with each kind's parameters and exports a constructor, and its
`panes.tsx` declares how the kind is shown. [`components/panes/kinds.ts`](components/panes/kinds.ts)
discovers those declarations. Today's kinds are:

- Inbox's single pane, the fallback when no root pane is open.
- A Sessions transcript, and a canvas a session published.
- A Files editor for a session artifact or machine file.
- A Screens view of one display or window. Each visible screen owns its connection and renderer, so
  closing a pane does not stop the source application.
- An Apps instance, which is not inherently session-backed.
- A Channels conversation. Its artifacts keep their Files identity when revealed as ordinary root
  editor panes rather than published as linked panes.

A session `.toy` artifact app remains an editor pane. Reusing the app compiler
and mounted runtime does not add another pane kind or transfer ownership from its
source file.

Each pane has a stable `id` that represents mounted identity, its kind plus the key of its content
(`createPane`), and an optional `sessionId` naming the session it belongs to, which keeps overlays and follow-up generic. A kind declares its `View`, its
pager dot's label and color, and optionally a `root`: the URL key and item schema that let users
open it, and how an item becomes a pane and back. The workspace URL is just those roots, in the
URL's order, deduplicated and capped at four panes; with none, Inbox is shown. Any pane can publish
linked panes through a browser-local graph owned by its workspace surface, and each publisher orders
its own. That graph contains composition only; it never copies transcripts, Channel messages, file
content, Inbox rows, or app state. [`model/panes.ts`](model/panes.ts) derives visible and reachable
panes from roots and publications as pure functions. Explicit focus can bring an overflow artifact
or child into the capped layout by replacing an unrelated pane while retaining its publishers.
Clearing focus restores the ordinary ordering. A surface's `reveal(pane)` focuses a pane it can
already reach and otherwise opens it: the main workspace adds it as a root, replacing the roots when
full, and Hyper opens its own apps and hands every other kind to the main workspace.

Sessions publish their selected artifact editor first, then any screen preview, canvases, and child
sessions, with the full artifact catalog remaining in their tray; switching artifacts replaces that
linked editor rather than filling the layout with every file. Sessions also own artifact auto-focus,
which each host applies to its surface.

`SessionPane` has three interaction modes:

- `active` is the primary interactive surface and publishes linked panes.
- `overlay` is interactive but secondary, so it does not publish another layer.
- `passive` stays live without accepting input or acknowledging the session as read.

Pane `variant` is a separate host concern. `WorkspacePaneView` looks up one pane's kind, renders its
view, and supplies host-owned action and status slots and the presentation variant through one
pane-shell context from [`src/shared/panes`](../../shared/panes/), the pane chrome kit that panes
share the way sidebar sections share `src/shared/sidebar`. Descendants declare controls with
`PaneActions` or `PaneStatus` without receiving DOM targets. This lets the grid and pager hosts
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

`components/panes/hosts` owns collection geometry and pane visibility,
`components/panes/WorkspacePaneView.tsx` adapts one pane to its kind's view inside the chrome slots
the hosts supply, and `components/panes/kinds.ts` holds the discovered kinds. None of them owns the feature state rendered
inside a pane.

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
  assembles the application route tree from Workspace's routes and every feature's `routes/`
  folder, which it discovers and mounts under `/api`.
- [`routes/__root.tsx`](routes/__root.tsx) owns the document shell, global presentation providers,
  and initial Workspace hydration. Its stylesheet is co-located in the same route boundary.
- [`routes/index.tsx`](routes/index.tsx) is the main composition root. It derives root panes
  from the URL, owns the root verbs (`selectRoot`, `openRoot`, `closeRoot`) that the sidebar,
  palette, and dialogs call with panes, and supplies shared state and commands to the responsive
  workspace shell.
- [`hooks/layout/surface.tsx`](hooks/layout/surface.tsx) owns the independent Main and Hyper surface
  stores, `reveal`, and `useSurfacePanes`, which derives a surface's visible panes from its roots
  and prunes publishers those roots no longer reach. [`hooks/layout/panePublications.ts`](hooks/layout/panePublications.ts) owns
  publication transitions.
- [`components/panes/WorkspacePaneView.tsx`](components/panes/WorkspacePaneView.tsx) is
  the single host-to-feature adapter. Feature components own content behavior; Workspace owns
  placement and focus. The pane model, publications, and surface that features import never
  import a feature.
- [Sessions](../sessions/AGENTS.md), [Channels](../channels/AGENTS.md),
  [Inbox](../inbox/AGENTS.md), [Files](../files/AGENTS.md), and
  [Apps](../apps/AGENTS.md) own the data and behavior rendered in their panes. Channels owns
  its Agent identity and membership UI.
- [Terminal](../terminal/AGENTS.md) owns its PTY and connection lifecycle; the main route
  owns only shared drawer visibility and size, while each responsive layout owns placement and
  transient presentation mechanics.

To add a pane kind, declare its parameters in the owning feature's model and a constructor that
names its content's key through `createPane`, which makes the id the kind plus that key, then add
the kind to that feature's `panes.tsx`, with a `root` if users can open it from the URL. To
add a workflow, compose existing panes and choose its host, focus surface, and session interaction
mode. To add a workbench command, define it in `commands.ts` over route state; the palette,
shortcuts, and any `CommandButton` that references its ID pick it up.

Preserve these invariants:

- Feature state remains authoritative; Workspace is an aggregate projection and composition shell.
- Pane IDs describe mounted content identity, and React keys follow them when content must remount.
- Passive previews may stream live work but must not acknowledge it as read.
- Secondary session surfaces must not recursively publish linked panes.
- Pane content publishes through its current surface and must not choose between Main and Hyper.
- Every session-backed pane carries its `sessionId` so overlays and follow-up stay generic.

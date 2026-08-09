# Workspace

Workspace is Toy Box's application composition layer. It owns two sibling capabilities:

- the shared projection and update plane that composes authoritative facts from Sessions, Inbox,
  Automations, Workers, Files, and Apps without becoming another source of truth; and
- the browser-local shell that composes feature-owned panes into the desktop, mobile, and Hyper
  layouts.

The projection has no knowledge of panes or layout. The shell consumes the projection where
cross-feature presentation requires it. Workspace is therefore a top-level subsystem rather than a
peer feature: features contribute facts and surfaces, while the main route assembles the product
through Workspace.

## Shared projection

`WorkspaceState` is the aggregate read model delivered during SSR and refreshed after reconnects.
It includes settings, sparse session activity, Hyper membership, environment capabilities, and
current projections supplied by each feature. Feature databases, registries, files, and session
history remain authoritative; Workspace only assembles their current values.

The snapshot path reads those feature-owned facts once; the event path incrementally maintains the
same flat materialized view. Features publish accepted changes through `server/events.ts`, while
the central pure reducer owns only composition invariants—for example, removing projected shares
and workers when an app disappears. It never performs a feature's persistence or lifecycle work.
Feature-specific Query factories may select from the shared cache, but must not create competing
copies of the same server state.

[`model/state/reducer.ts`](model/state/reducer.ts) applies the same `WorkspaceEvent` transitions on
the server and in each browser. The sparse `sessionStates` map retains only meaningful shared
activity: a draft, active work, unread completion, or a pending draft prompt. Ordinary read-idle
sessions have no entry.

[`queries.ts`](queries.ts) is the canonical TanStack Query interface to that projection. It owns
snapshot identity, optimistic workspace commands, and a per-`QueryClient` event journal that keeps
an in-flight snapshot from overwriting newer events. [`hooks/state.ts`](hooks/state.ts) exposes
narrow reactive selectors and the two client command hooks; it does not copy server state.

[`hooks/useWorkspaceSync.ts`](hooks/useWorkspaceSync.ts) is the single browser sink for the
at-most-once workspace SSE stream. On initial connection or reconnect it refreshes the aggregate
snapshot and durable session list, then applies subsequent events to their owning Query caches.
Events announce accepted changes; they are synchronization hints, not durable truth or a replay
log.

[`server/functions.ts`](server/functions.ts) validates remote ingress for hydration, shared
workspace actions, and settings updates, then delegates to the plain operations in
[`server/index.ts`](server/index.ts). That module assembles the cross-feature snapshot and owns
Workspace-level orchestration. [`server/state/`](server/state) owns only workspace-wide
coordination: sparse shared session activity, Hyper membership, settings, and environment
capabilities. [`server/events.ts`](server/events.ts) owns the process-local fan-out behind the
shared SSE route. Shared SQLite connection management stays in [`../server/`](../server), while
each feature owns its records and lifecycle.

Browser-local pane topology, focus, layout, and client identity are deliberately absent from the
server projection.

## Pane model

`WorkspacePane` is the shared presentation value for five kinds of content:

- Inbox is the stable fallback when no root pane is selected.
- A session pane is sourced by its own session ID.
- An editor pane presents a session artifact or machine file.
- A canvas pane presents an SDK-provided URL associated with its source session.
- An app pane presents one durable app instance and is not inherently session-backed.

Each pane has a stable ID that represents mounted identity. [`model/panes.ts`](model/panes.ts) owns
identity, source relationships, reachability, ordering, and focus policy as pure functions. Root
sessions, files, and apps are deduplicated and capped at four panes. Active session, Inbox, and app
panes can publish linked panes through a browser-local graph owned by their workspace surface. That
graph contains composition only; it never copies transcripts, file content, Inbox rows, or app
state.

`SessionPane` has three interaction modes:

- `active` is the primary interactive surface and publishes linked panes.
- `overlay` is interactive but secondary, so it does not publish another layer.
- `passive` stays live without accepting input or acknowledging the session as read.

Pane `variant` is a separate host concern. `WorkspacePaneView` maps one pane value to its feature
component and scopes host-owned action and status slots around it. Descendants declare controls
with `PaneActions` or `PaneStatus` without receiving DOM targets. This lets the grid, pager, and
Hyper host compose identical content while preserving each feature's lifecycle.

## Layouts and compositions

[`components/layout/WorkspaceGrid.tsx`](components/layout/WorkspaceGrid.tsx) is the always-mounted
desktop host. It lays out up to four panes, preserves useful sizing as panes change, and owns
maximize and restore behavior.

[`components/layout/WorkspacePager.tsx`](components/layout/WorkspacePager.tsx) is the compact host
used by mobile and Hyper. It keeps inactive pages mounted so paging preserves scroll and local
surface state, and portals the active pane's controls into its toolbar.

[`components/layout/HyperSession.tsx`](components/layout/HyperSession.tsx) is an independent
mini-workspace around a managed session. It has its own roots, focus, and publication graph while
reusing the ordinary pager and pane components. Promotion preserves the transcript and live
runtime while transferring lifecycle management into the normal workspace.

[`../features/sessions/components/SessionPreview.tsx`](../features/sessions/components/SessionPreview.tsx)
renders a passive session in a delayed hover popover. [`../features/sessions/components/SessionOverlay.tsx`](../features/sessions/components/SessionOverlay.tsx)
is the reusable follow-up surface for session-backed output shown without its source session pane.

## Ownership and extension

- [`../routes/index.tsx`](../routes/index.tsx) is the main composition root. It derives root panes
  from the URL and chooses the desktop or compact host.
- [`hooks/layout/surface.tsx`](hooks/layout/surface.tsx) owns the independent Main and Hyper surface
  stores. [`hooks/layout/panePublications.ts`](hooks/layout/panePublications.ts) owns publication
  transitions and editor display mode.
- [`components/panes/WorkspacePaneView.tsx`](components/panes/WorkspacePaneView.tsx) is the single
  host-to-feature adapter. Feature components own content behavior; Workspace owns placement,
  focus, and chrome.
- [Sessions](../features/sessions/AGENTS.md), [Inbox](../features/inbox/AGENTS.md),
  [Files](../features/files/AGENTS.md), and [Apps](../features/apps/AGENTS.md) own the data and
  behavior rendered in their panes.
- [Terminal](../features/terminal/AGENTS.md) owns its PTY and connection lifecycle; the main route
  owns only its drawer visibility, size, and mobile or desktop placement.

To add a pane kind, define its stable identity and source relationship, render it once in
`WorkspacePaneView`, and extend ordering or focus policy only when product behavior requires it. To
add a workflow, compose existing panes and choose its host, focus surface, and session interaction
mode.

Preserve these invariants:

- Feature state remains authoritative; Workspace is an aggregate projection and composition shell.
- Pane IDs describe mounted content identity, and React keys follow them when content must remount.
- Passive previews may stream live work but must not acknowledge it as read.
- Secondary session surfaces must not recursively publish linked panes.
- Pane content publishes through its current surface and must not choose between Main and Hyper.
- Every session-backed output retains its source session so overlays and follow-up stay generic.

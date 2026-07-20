# Workspace Pane System

The workspace pane system turns Inbox, conversations, and their outputs into reusable surfaces instead of one-off screens. The same pane model composes the resizable desktop grid, mobile pager, and floating Hyper workspace without creating another execution or content-state model. Panes own content behavior; hosts own placement, focus, and chrome. Session previews and overlays reuse `SessionPane` for smaller interaction modes without entering the pane graph.

## Pane model

`WorkspacePane` is the shared presentation value for four kinds of content:

- The Inbox pane is the stable fallback workspace when no session is selected.
- A session pane is sourced by its own session ID.
- An artifact pane is a durable file associated with the session that produced it.
- A canvas pane is an SDK-provided URL surface associated with its source session.

Each pane has a stable ID that represents its mounted identity. Inbox uses the singleton ID `inbox`; artifact identity includes its source session and relative path, while canvas identity includes its revision so a new revision remounts the surface. `paneSourceSessionId` resolves the session behind every session-backed pane without pretending Inbox is a session.

Selected sessions come from the route. When none are selected, Inbox is the fallback root pane. An active `SessionPane` publishes the linked sessions, artifacts, and canvases revealed by its reduced session state; `InboxPane` can publish one explicitly selected Inbox artifact. Publications are keyed by the publishing pane's ID in browser-local layout state. Pure derivation in [`../../lib/workspace/panes.ts`](../../lib/workspace/panes.ts) walks those relationships, prioritizes panes, and produces the visible workspace. This state describes one browser's composition; it is not server workspace state and does not copy session transcripts, Inbox rows, or artifact content.

`SessionPane` has three interaction modes:

- `active` is the primary interactive surface and publishes linked panes.
- `overlay` is interactive but secondary, so it does not publish another layer of panes.
- `passive` observes a live session without accepting input or acknowledging it as read.

Active and overlay panes use active session subscriptions; passive panes use passive subscriptions. An overlay therefore acknowledges existing unread work and suppresses a future unread completion while it is open, whereas a preview does neither.

Pane `variant` is a separate host concern. `WorkspacePaneView` defaults to normal presentation, so the desktop grid relies on that default and only the compact pager specifies a variant. Direct secondary session surfaces omit the variant as well: overlay and passive modes derive compact presentation, while mode itself defaults to active. Each grid cell and pager page positions action and status slots, then hands them to `WorkspacePaneView`, the single host-to-pane boundary. The grid floats actions above the upper-right content and status above the lower-right content; the pager composes both slots into its header. That view scopes the slots around the selected leaf implementation and any host adjuncts; descendants declare into them with `PaneActions` or `PaneStatus` without receiving DOM targets. The pager gives only its active page real slots because inactive pages remain mounted. Pane modes still decide whether a declaration is semantically appropriate: for example, only an active compact session contributes title-bar actions, so a nested overlay session cannot leak chrome into its host artifact. This lets grid, mobile pager, and the Hyper pager compose identical panes without changing their session or artifact lifecycles.

## Layouts and compositions

[`layout/WorkspaceGrid.tsx`](layout/WorkspaceGrid.tsx) is the always-mounted desktop host. It lays out up to four panes, preserves useful user sizing as panes enter and leave, and owns maximize and restore behavior. Inbox occupies the grid alone by default and can add an artifact beside it. Maximizing a session-backed output adds a `SessionOverlay` for its source session, keeping the output primary while making its conversation available in place.

[`layout/WorkspacePager.tsx`](layout/WorkspacePager.tsx) is the compact host used by the mobile workspace and Hyper. It renders the same panes through `WorkspacePaneView`, portals pane actions into its toolbar, and keeps inactive pages mounted so paging preserves scroll and local surface state. An explicit Inbox artifact selection asks this host to focus the new page; the grid leaves the artifact beside Inbox instead.

[`panes/session/SessionPreview.tsx`](panes/session/SessionPreview.tsx) renders a passive `SessionPane` in a delayed hover popover. It remains live while a session runs, but previewing does not mark the session read or expose a composer. Sidebar sessions and Inbox rows share this behavior.

[`panes/session/SessionOverlay.tsx`](panes/session/SessionOverlay.tsx) is the reusable follow-up control. Given only a session ID, it derives running state for its trigger and opens an overlay-mode `SessionPane`. Workspace hosts use it when a session-backed output is visible without its source session pane, including artifacts published by Inbox.

[`layout/HyperSession.tsx`](layout/HyperSession.tsx) is an independent mini-workspace around a managed session. It derives that session's linked panes, gives them a separate focus surface, and hosts them in `WorkspacePager` inside a movable window. Promotion preserves the transcript and any live runtime while transferring lifecycle management into the normal workspace; a future cold resume resolves the session's standard role.

`InboxPane` links at most one artifact pane. Clicking the linked row again removes it; clicking another row replaces it. The artifact keeps the Inbox entry's managed session ID as its source, so hosts can supply `SessionOverlay` whenever that source session is not already another visible pane. This keeps asynchronous artifact generation and follow-up in the normal pane model without introducing a special artifact-session implementation. See [`panes/artifacts/AGENTS.md`](panes/artifacts/AGENTS.md) for file ownership, watch, edit, serve, and renderer behavior.

## Ownership and extension

- [`../../routes/index.tsx`](../../routes/index.tsx) is the main composition root. It turns selected sessions or fallback Inbox into root panes, always hosts them in the desktop grid, and uses a mobile-only layout cookie to choose between the sidebar and pager.
- [`../../lib/workspace/panes.ts`](../../lib/workspace/panes.ts) owns pane identity, source relationships, reachability, ordering, and focus policy as pure functions.
- [`../../hooks/workspace/layout/linkedPanes.ts`](../../hooks/workspace/layout/linkedPanes.ts) owns browser-local publication by publisher-pane ID and artifact display mode.
- [`panes/WorkspacePaneView.tsx`](panes/WorkspacePaneView.tsx) is the single host-to-pane adapter shared by grid and pager: it scopes host slots, maps a pane value to its leaf component, and wraps host adjuncts without owning their policy.
- Pane components own content lifecycle and presentation. Layout components own placement, resizing, paging, focus, and host chrome.
- Main and Hyper surfaces have independent focus state. `WorkspaceSurfaceProvider` owns each surface's focus namespace, keeps its focus valid, and applies artifact auto-focus policy without putting layout concerns into pane content.

To add a pane kind, define its stable identity and whether it is session-backed, render it once in `WorkspacePaneView`, and extend pure ordering or focus policy only when the product behavior requires it. To add a workflow, compose existing panes and choose its host, focus surface, and session interaction mode. Do not duplicate session state, artifact state, or runtime behavior in layout state.

Preserve these invariants:

- Pane IDs describe mounted content identity; React keys should follow them when switching content requires a new lifecycle.
- Session and artifact data remain authoritative in their owning hooks and server subsystems. Pane state contains only composition and presentation policy.
- Passive previews may observe live work but must not acknowledge it as read.
- Secondary session surfaces must not recursively publish linked panes.
- Every session-backed non-session pane must retain its source session so shared overlays and follow-up workflows remain generic; Inbox is explicitly not session-backed.

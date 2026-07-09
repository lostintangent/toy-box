# The Workspace Domain

A descriptive map of the workspace/pane/artifact system: its nouns, verbs, states, and ownership. Everything here was verified against the code as of this writing. (Companion analysis lives in the review that produced this file; this document only describes what *is*.)

## Layering

```
selection (URL)                    routes/index.tsx
    │ derive roots
    ▼
WorkspacePane values  ◄─ publish ─ active SessionPane / InboxPane
    │ lib/workspace/panes.ts          hooks/workspace/layout/useLinkedPanes.ts
    │ reachability → visibility → order
    ▼
hosts (placement, chrome, focus)   layout/WorkspaceGrid, layout/WorkspacePager, layout/HyperSession
    │ WorkspacePaneView (kind → component)
    ▼
pane content (behavior)            panes/session, panes/artifacts, panes/CanvasPane, panes/inbox
    │
    ▼
data truth                         server workspace state (lib/workspace/state.ts reducer → atoms),
                                   session state (useSession), artifact files (useArtifact)
```

Invariant: pane state holds only **composition and presentation policy**. Session transcripts, inbox rows, and file content are never copied into it.

## 1. The pane value — `WorkspacePane` (`lib/workspace/panes.ts`)

One tagged union, four kinds. The `id` is *mounted content identity*: equal id ⇒ same live surface; changed id ⇒ remount.

| kind       | id                                        | fields                                            | session-backed |
| ---------- | ----------------------------------------- | ------------------------------------------------- | -------------- |
| `inbox`    | `inbox` (singleton `INBOX_PANE`)          | —                                                 | no             |
| `session`  | `session:<sessionId>`                     | `sessionId`, `isLinkedOnly`                       | itself         |
| `artifact` | `artifact:<sourceSessionId>:<path>`       | `sourceSessionId`, `path`, `title`, `mode`        | yes            |
| `canvas`   | `canvas:<sourceSessionId>:<key>:<rev>`    | `sourceSessionId`, `canvas` (SDK URL surface)     | yes            |

- Artifact identity = source + path, so mode changes preserve the mount; canvas identity includes revision, so a revision bump remounts.
- `paneSourceSessionId(pane)` is the single relationship resolver: a session pane is its own source; artifact/canvas carry their producer; Inbox has none.
- `isLinkedOnly` marks a session pane that was *derived* (published by another pane) rather than *selected* (in the URL).
- `ArtifactPaneMode = "read" | "edit" | "shared"` rides on the pane value. Default: `shared`, except automation-produced artifacts default to `read`.

## 2. The pane graph — publications (`useLinkedPanes`)

Browser-local Jotai state: `Record<publisherPaneId, WorkspacePane[]>`. This is one browser's composition, never server state.

**Who publishes:**
- An **active** `SessionPane` publishes the linked sessions, artifacts, and canvases revealed by its reduced session state, keyed by its own pane id. It clears its publication on unmount.
- `InboxPane` publishes at most **one** explicitly selected Inbox artifact (toggle: same row unlinks, other row replaces).
- Overlay and passive session panes never publish (no recursive layers).

**Verbs:** `publishSessionPanes(sourceSessionId, linkedSessionIds, canvases, artifacts)` (preserves prior artifact modes), `publishLinkedPanes(publisherPaneId, panes)`, `clearSessionPanes(sourceSessionId)`, `prunePanePublishers(reachableIds)`, `setArtifactPaneMode(pane, mode)` (rewrites the pane wherever published).

Publication writes are identity-stable: `haveSamePanes` bails out when nothing observable changed (id, kind, artifact mode/title, session isLinkedOnly).

## 3. Derivation — pure functions (`lib/workspace/panes.ts`)

- `deriveWorkspaceRootPanes(selectedSessionIds)` → session panes for the URL selection, or `[INBOX_PANE]` when empty. **Inbox is the fallback root, not a session.**
- `deriveReachablePanes` → BFS from roots through publications (cycle-safe). Reachability decides which publishers survive `prunePanePublishers`.
- `deriveVisibleWorkspacePanes({rootPanes, linkedPanesByPublisher, maxVisible=4})` → roots first, then linked panes ordered **artifact → canvas → session**, capped.
- `deriveOpenSessionIds(panes)` → sessionIds of rendered session panes (selected + linked).
- `resolveArtifactAutoFocus(seenPaneIds, panes, scope)` → at most one newly-appeared artifact pane may claim focus, only in single-session layouts; tracking advances even when suppressed, so focus is claimed at most once per appearance.

## 4. Focus — per-surface (`layout/focus.tsx`, `useWorkspaceFocus`)

Two independent surfaces, `main` and `hyper`, each a `focusedPaneId: string | null` atom, delivered via context (`WorkspaceSurfaceProvider`). **The meaning of focus is the host's:**

- Grid: focused = **maximized** (other panels resize to 0; Escape or pane departure restores).
- Pager: focused = **active page** (dots select; null falls back to the primary root pane).

`useWorkspaceFocus(panes, surface)` keeps focus valid (clears when its pane departs) and applies artifact auto-focus policy. Focus writers: grid maximize buttons, pager dots, Inbox's "focus the artifact I just linked" request, auto-focus.

## 5. Hosts

**`WorkspaceGrid`** — always-mounted desktop host, ≤ 4 panes in a 2×2 of nested resizable panels. Owns: canonical layouts per count, step-wise count transitions that preserve user sizing (`applyWorkspaceGridCountChange`, tested), maximize/restore via focus, per-cell hover chrome (maximize / minimize / close), and mounting a `SessionOverlay` on a session-backed output pane when it is maximized or its source session isn't a sibling pane.

**`WorkspacePager`** — compact host for the mobile workspace and the hyper deck. Renders every pane stacked and toggles *visibility* (not mount) so inactive pages keep scroll and local state. Owns: the toolbar (back button, status dots, an actions slot the active pane fills), portaling that toolbar into a host-provided `toolbarSlot` (the hyper window title bar). Dots encode active > running > unread > kind.

**`HyperSession`** — not a third layout: a floating, draggable mini-workspace around one managed session. It derives that session's linked panes from the same graph (cap 6), gives them the separate `hyper` focus surface, and hosts them in a `WorkspacePager`. Window chrome: traffic lights — delete, minimize, **promote** (dispatches `session.hyper.promoted`, transferring lifecycle to the normal workspace and opening the session there). Browser-local `{sessionId, position, open}` lives in `useHyperSession`; *existence* is authoritative in shared `hyperSessionIds`.

**`WorkspacePaneView`** — the single kind→component mapping both hosts share.

Host/pane contract (`panes/types.ts`): `variant: "normal" | "compact"` (inline controls vs controls declared into the host's `actionsSlot`), plus the slot element itself.

## 6. Pane content

**`SessionPane`** — mode axis `active | overlay | passive`:
- `active`: primary surface; live subscription; publishes linked panes.
- `overlay`: interactive but secondary; live subscription (acknowledges unread); never publishes.
- `passive`: observes without composer and **without marking read**.

Also owns: draft creation options (directory, worktree, model seeding), composer + transcript, worktree merge/apply, compact-variant portal of location picker + badges into host chrome.

**`ArtifactPane`** — composes for one `{sessionId, path}`:
- `useArtifact` (one file lifetime: initial read, SSE watch, debounced+serialized writes, own-echo suppression, flush-on-unmount),
- `ArtifactActions` (saving spinner + mode menu) declared into the host slot when the kind is editable,
- the kind-resolved renderer behind Suspense + an error boundary.
Mode semantics: `read` = presentation-only (Markdown comments still allowed) · `edit` = persist silently · `shared` = persist + debounced `artifact_edited` nudge to the owning agent. Markdown comments spawn ordered, self-deleting **comment sessions** whose presence is projected back into the editor.

**`CanvasPane`** — an SDK-provided URL in a sandboxed iframe; rewrites loopback hosts; no file behavior. A canvas is *not* an artifact.

**`InboxPane`** — the fallback workspace. A composer that creates sessions *without* opening a client stream, plus server-authoritative entries. An entry and its managed session share one id, so a linked Inbox artifact's `sourceSessionId` is the entry id — which is what lets hosts supply a generic `SessionOverlay` for follow-up. Unmount or entry deletion clears its publication.

**Off-graph reuses of `SessionPane`:** `SessionPreview` (delayed hover popover, passive) and `SessionOverlay` (bottom-right follow-up window, overlay mode, derives running state for its trigger).

## 7. Artifact kinds (`panes/artifacts/kinds`)

Registry resolved from the file extension at point of use — pane state stores only the path.

- Built-ins: **markdown** (Documint editor; comments; diffs), **html/svg** (sandboxed iframe, injected `<base>` for relative resources, postMessage edit bridge).
- **Custom kinds**: user-registered `{name, extensions, editable, html}` from shared workspace state; rendered by `CustomArtifact` via a bridge that posts content in and accepts replacements only when editable.
- Precedence: built-ins beat custom claims; unclaimed extensions fall back to Markdown.
- `ArtifactKind = {extensions, Renderer, icon, editable, fileIcons?, definition?}`; `editable: false` hides the mode menu entirely.

## 8. Shared workspace state feeding the UI

`lib/workspace/state.ts` — one canonical reducer for server store and client projection (`useWorkspace` hydrates, applies SSE events, replays events buffered during snapshot fetches, and dispatches optimistic actions).

Per-session status machine (missing = idle; representation excludes idle-without-prompt):

```
(absent) ──draft.created──► draft ──creating──► creating ──upserted──► running ──unread──► unread ──read──► idle/(absent)
   ▲            │                       │ idle                            │ idle             │
   └─discarded──┘                       └──► draft (create failed)        └──► idle/(absent) │
                                                                         (deleted ⇒ absent, always)
```

`creating` counts as running for activity UI. Also owned here: `hyperSessionIds` (membership; promote/discard/delete remove), `inboxEntries`, `artifactCommentSessions`, `customArtifacts`, `environment`.

Atoms (`hooks/workspace/atoms.ts`) are narrow projections with equality guards, so one session's activity never notifies another's subscribers.

## 9. State axes at a glance

| Concept            | Axis                | Values                                 | Owner                          |
| ------------------ | ------------------- | -------------------------------------- | ------------------------------ |
| Artifact pane      | `mode`              | `read · edit · shared`                 | pane value (browser-local)     |
| Session pane       | interaction `mode`  | `active · overlay · passive`           | mounting surface (prop)        |
| Any pane           | `variant`           | `normal · compact`                     | host (prop)                    |
| Workspace session  | `status`            | `draft · creating · running · unread · idle(=absent)` | shared reducer  |
| Artifact file      | runtime             | `isLoading · isReady · isSaving · error · revision` | `useArtifact`     |
| Focus surface      | `focusedPaneId`     | pane id or null, per `main`/`hyper`    | focus atoms + host semantics   |
| Hyper deck         | window              | `{sessionId, position, open}`          | `useHyperSession` (browser)    |

## 10. Ownership index

| Unit | Owns |
| ---- | ---- |
| `routes/index.tsx` | URL selection → root panes; choosing grid vs pager vs sidebar; graph pruning; hyper wiring; app chrome |
| `lib/workspace/panes.ts` | pane identity, source relationships, reachability, visibility order, focus policy (pure) |
| `hooks/workspace/layout/useLinkedPanes.ts` | publications by publisher pane id; artifact mode rewrites |
| `hooks/workspace/layout/focus.tsx` + `useWorkspaceFocus.ts` | per-surface focus validity + auto-focus application |
| `layout/*` | placement, resizing, paging, window chrome — never content state |
| `panes/*` | content lifecycle and presentation — never placement |
| `hooks/artifacts/useArtifact.ts` | one mounted file's read/watch/write lifetime |
| `lib/workspace/state.ts` + `hooks/workspace/atoms.ts` | shared workspace truth and its narrow client projections |

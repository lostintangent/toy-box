# Workspace Files

## The whole design in one line

Replace the artifact address `{ sessionId, path }` with **one value, `WorkspaceFile`**, carry it every place a path is carried today, and let "artifact" survive as the session-typed member. Opening real files — with the same edit / watch / comment / worker behavior — falls out of the address change; it is not a parallel system.

The core is exactly what you'd expect it to be: **a workspace file, a file pane, a workspace file hook, and a set of call sites that take a `WorkspaceFile` instead of a path.** Nothing else is new.

---

## Core ontology — the entire new type surface

```ts
// The one address. Identity + resolution. Nothing else is a "file address".
type WorkspaceFile =
  | { type: "session"; sessionId: string; path: string } // an artifact — session-relative
  | { type: "machine"; path: string }; // a real file — canonical absolute path
```

Three pure helpers, each used in ≥2 places (the bar for existing at all):

```ts
workspaceFileId(file): string           // identity: pane id, worker queue key, notification coalesce key
encodeWorkspaceFile / decodeWorkspaceFile // wire token for the HTTP routes
resolveWorkspaceFile(file): string | null // server: address → absolute path
```

Everything else in the change is a **rename of something that already exists.**

### Nouns / verbs we deliberately do NOT introduce

- **No `FileScope` + `FileRef` pair.** The union _is_ the address. A "scope" carrying no data beyond a discriminant is a tag, not a noun.
- **No `workspace` / `local` members.** Same file, two spellings — a scope split would fracture identity. Cwd-relativity is display only, via the existing `toRelativePath(abs, cwd)` in `lib/paths.ts`.
- **No `inbox` member.** Inbox files become ordinary session files (§ Inbox).
- **No `owner` field on `WorkspaceFile`.** Ownership is contextual; storing it in the address fractures identity. It is derived (§ Ownership).
- **No `Grant` / allow-list noun.** A machine file is accessible iff it is open (§ Access).
- **No `FilePath` / `FileLocator` / `FileScopeCodec` redirections.** One type, one id fn, one codec, one resolver.

---

## The three surfaces

1. **Workspace file** — `WorkspaceFile`, above.
2. **File pane** — the `WorkspacePane` union's `kind: "file"` member (renamed from `"artifact"`):
   ```ts
   {
     kind: "file";
     id: string;
     file: WorkspaceFile;
     title: string;
     mode: FilePaneMode;
   }
   ```
   `id = workspaceFileId(file)`. Owner is **not stored** — derived at use. **One** constructor, `createFilePane(file, { mode? })`; the artifact case is `createFilePane({ type: "session", … })`, so there is no second constructor.
3. **Workspace file hook** — `useWorkspaceFile(file, mode)` (renamed from `useArtifact`). Body unchanged: read, watch, serialized writes, flush-on-unmount.

---

## The call sites that take a `WorkspaceFile` instead of a path

All mechanical, all the same swap:

| Place                | today                                  | after                                   |
| -------------------- | -------------------------------------- | --------------------------------------- |
| resolver             | `resolveArtifactPath(sessionId, path)` | `resolveWorkspaceFile(file)`            |
| read / write RPC     | `{ sessionId, path }`                  | `{ file }`                              |
| watch / serve routes | `/$sessionId/$path`                    | `/$scope/$path` (`encodeWorkspaceFile`) |
| URL / base builders  | `(sessionId, path)`                    | `(file)`                                |
| renderer props       | `sessionId`                            | `file`                                  |
| worker address       | `{ sourceSessionId, path }`            | `{ ownerSessionId, file }`              |
| edit notification    | `{ path }`                             | `{ file }`                              |

**Untouched** (already take an absolute path or a pane): `fs.watch`, the serve byte route, the write queue, every renderer component, the extension registry, pane-graph traversal.

---

## Session state — no migration

- `Session.artifacts: string[]` — **unchanged.** Session-typed files as bare paths (type + id implicit from context); the composer pills. Materialize with `createFilePane({ type: "session", sessionId: self, path })`.
- `Session.openedFiles: WorkspaceFile[]` — **new, defaults `[]`.** Durable machine files the agent opened. Written by the projector from persisted `open_file` / `close_file` tool calls → `file_opened` / `file_closed` events — the _same_ path artifacts already take (tool call → projector → reduced state), so durability is free.

Two lists, not one, **specifically to avoid migrating `artifacts`** — and they are genuinely different in the domain (authored output vs. opened working file) and shown in different UI.

---

## Ownership & access — both derived, neither a subsystem

- **Owner** = `file.type === "session" ? file.sessionId : ⟨sessions whose openedFiles include this id, ∪ the active session for a browser-local open⟩`. Emerges from per-session `openedFiles` + dedup; not stored, not an association lifecycle.
- **Access grant = the open.** `resolveWorkspaceFile` accepts a machine path iff it is in some session's `openedFiles` or a live browser-local open. No allow-list to maintain; grants reconstruct from replay for free. Canonicalize the path; with one trusted local owner, stop there.
- **A worker needs an owner.** Owned machine files (agent-opened, or user-opened while a session is focused) get comments + workers exactly like artifacts: `spawnFileWorker({ ownerSessionId, file })`, queue keyed by `workspaceFileId(file)` — which serializes concurrent edits to one real file for free. Ownerless opens persist comments as content but spawn nothing. Multi-owner arbitration is not built: parent to the triggering session, let the queue serialize.

---

## Agent verbs

`open_file(path)` and `close_file(path)` — two idempotent verbs. Not a toggle (the agent can't observe pane state), not one `action` tool (an action param makes mode/focus conditionally valid). Each handler resolves `path` against the session cwd → canonical `WorkspaceFile`, returns it; durability comes from the projector reading the persisted call.

---

## Inbox = session (hard cut, no compat)

`send_to_inbox` writes the artifact through the SDK — `session.rpc.workspaces.createFile({ path: filename, content })` on the managed session (via the runtime's live session handle), and records only the filename on the row. That file projects as an ordinary session artifact. **Delete** the `~/.toy-box/inbox` store, the resolver branch, the deletion path, the special system instruction, and their tests. An inbox pane is a `session` file pane; keep it in `shared` mode so `file_edited` fires.

---

## Notification — outright replace

```ts
type AgentNotification = { type: "file_edited"; file: WorkspaceFile };
```

One registry entry in `agentNotifications.ts` (`notifyAgentInputSchema` follows for free; the codec is payload-agnostic). Label stays the basename ("Edited report.md"); coalesce on `workspaceFileId`. The instruction gains one line on resolving the two members. No legacy `artifact_edited` decoding.

---

## Build sequence, with a convergence check per stage

### 1 — Inbox → SDK session files (hard cut)

**Do:** route `send_to_inbox`'s write to `workspaces.createFile`; delete the inbox store, resolver branch, deletion path, system instruction, tests; row keeps the filename.
**Convergence:** nouns added **0**; nouns _removed_ (inbox root, `resolveInboxArtifactPath`, the branch). A pure deletion — the best kind. No conversion, so no migration.

### 2 — `WorkspaceFile` + id + codec + `file_edited`

**Do:** add the union, `workspaceFileId`, `encode/decode`; swap the notification type and its one registry entry.
**Convergence:** nouns added: `WorkspaceFile` (core), `FilePaneMode` (rename of `ArtifactPaneMode`). Verbs: `workspaceFileId`, `encode/decode` — each used by both routes and identity. Rejected: `FileScope`/`FileRef`, an `owner` field.

### 3 — Generalize hook / pane / routes / renderers / **workers** to `WorkspaceFile`

**Do:** `useArtifact → useWorkspaceFile(file)`; artifact pane → file pane; RPC `{ file }`; routes `$scope`; renderer prop `file`; `spawnArtifactWorker → spawnFileWorker({ ownerSessionId, file })`; URL builders take `file`. Artifact UX retained (materialize `Session.artifacts`).
**Convergence:** pure re-addressing — every diff is "path → `WorkspaceFile`." One pane constructor (dropped `createSessionFilePane`). Worker change is address-only — **rename `ArtifactWorker`'s fields, do not add a worker type.** Behavior identical; existing tests stay green.

### 4 — Machine resolution + grant-is-open

**Do:** `resolveWorkspaceFile` machine arm = canonical path iff in the open set.
**Convergence:** verbs added **0** (it's the second arm of the existing resolver). Rejected: a `Grant` noun, an allow-list store, symlink re-validation.

### 5 — Durable `openedFiles` + projector events + `open_file` / `close_file`

**Do:** add the field; `file_opened` / `file_closed` scalar events; projector policies for the two tools; reducer cases; the two tools.
**Convergence:** nouns: `openedFiles` (needed to reduce the projection), two **scalar** events (not a patch wrapper), two verbs. All load-bearing. Reuses the artifacts projection pattern — no new persistence path.

### 6 — Merge duplicate machine panes, derive `ownerSessionIds`

**Do:** pane derivation dedups by `workspaceFileId`; `ownerSessionIds` = the union of contributing sessions.
**Convergence:** no new stored noun (`ownerSessionIds` is derived); dedup is one line; it emerges from stage 5's per-session lists. No association-lifecycle machinery.

### 7 — Browser-local user file selection (tree view)

**Do:** `listDirectory` returns files too; a file-capable browser (extend the existing dialog); selecting publishes a file pane into the browser-local linked-pane store with `owner = active session` (process-local).
**Convergence:** reuses `publishLinkedPanes` (the Inbox pattern) and the existing directory browser. No durable write, no new RPC.

### 8 — Cosmetic renames

**Do:** file/dir renames (artifacts → files) where they still clarify; reframe "artifact" as the session member in the AGENTS.md guide and system prompt.
**Convergence:** zero behavior; optional.

---

## Final tally

- **Added:** 1 type (`WorkspaceFile`), 1 field (`openedFiles`), 2 scalar events, 1 notification reshape, 2 agent verbs. Everything else is a rename.
- **Removed:** the inbox store + resolver branch + instruction, `artifact_edited`. **Never introduced:** `FileScope`/`FileRef`, `owner` field, `Grant`/allow-list, a file-worker type, workspace/local scopes.
- **Net: the surface shrinks while capability grows.** That is the convergence test.

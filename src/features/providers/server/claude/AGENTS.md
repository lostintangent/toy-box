# Claude Agent provider

The official Claude Agent SDK uses the owner's installed `claude` executable and login.
Each attached session has one SDK query; the SDK owns subprocesses and stdio. Native session
creation uses the Sessions-owned UUID through the SDK's `sessionId` option. This provider owns no database,
sidecar files, or durable metadata.
Query teardown awaits the SDK's iterator `return()` so the CLI finishes flushing native history
before Sessions deletes it; `close()` starts that cleanup without awaiting it.

| Module           | Responsibility                                                 |
| ---------------- | -------------------------------------------------------------- |
| `provider.ts`    | Native catalogs, creation, resume, history, and deletion       |
| `client.ts`      | CLI discovery and SDK query cleanup                            |
| `models.ts`      | Native model identities, labels, and catalog options           |
| `connection.ts`  | One live session's input, controls, and request callbacks      |
| `projector.ts`   | Live and historical native events into canonical SessionEvents |
| `messages.ts`    | Native text, images, shared system messages, and slash prompts |
| `history.ts`     | SDK history reconstruction with native tool-result metadata    |
| `tools.ts`       | In-process MCP host for supplied Toy Box tools                 |
| `fileChanges.ts` | Native edit hunks into the shared diff format                  |

Sessions keeps queued messages; messages sent while native work is active use Claude's
`next` priority to steer at the next model step. `now` interrupts the current turn. Claude
surfaces `next` input to the model as text only, so an immediate message with images uses
`later` and runs once the active turn ends instead of losing its images.
Enable `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` and `CLAUDE_CODE_BG_TASKS_REPORT_RUNNING`:
native `session_state_changed: idle` follows background work and its notifications.
A `result` is only a turn result and must not finish the shared stream.
Explicit `allowedTools` keeps native checklists available on newer models.
Model and reasoning effort change together through the session-scoped `applyFlagSettings` API.

`tools.ts` registers the supplied tools with the official MCP SDK in process, passing that
instance to the Agent SDK. There is no HTTP server or custom transport. Full Zod schemas
preserve refinements and recursive JSON fields; use the app's MCP/Zod dependencies because
the Agent SDK's bundled schema converter cannot serialize the current recursive schemas.
Native tool context supplies cancellation and call identity; successful terminal tools use
`claude/endTurn`. Native ToolSearch discovers deferred tools.

The supplied skill directories are native local plugins; standalone `SKILL.md` roots need
no copied files or generated manifests. `reloadSkills()` supplies slash completion.
Native permissions follow Toy Box's trusted-owner policy, with `AskUserQuestion` delegated
to the shared question UI when the session's role allows it.

Images and shared system messages round trip through native history without staging files.
Artifacts remain entirely owned by Sessions and Files. Omitted tools need no lifecycle tracking;
checklists, questions, and background agents retain only the native correlation they require.
Live background agent cards stay running from native `task_started` through
`task_notification`, including failed or stopped outcomes. Historical reads retain the
native launch result and child transcript; the SDK does not replay those live task signals.
The native `task-notification` origin keeps internal completion prompts out of the transcript.

`history.ts` uses the SDK's native export into a request-local buffer, then its history APIs
for active-branch and subagent reconstruction. Exported records restore structured tool
results and effort that `getSessionMessages()` omits. Nothing is persisted or mirrored;
the buffer is never installed as a live query's session store.

The SDK reads a session's `cwd` only from the first 64 KB of its transcript (its branch comes from
the tail), so a large first message, such as a pasted image, leaves the catalog without a
directory. `readDirectory` alone reads the first transcript entry that records one, through
`importSessionToStore`, so resuming such a session does not fall back to the home directory.

Creation names use the SDK's `title` option; later names use `renameSession()`. The SDK's
`customTitle` includes generated native titles too, so automatic Toy Box renames preserve
any existing native title. Conversation rewind remains unavailable: native
`rewindFiles()` changes files, `resumeSessionAt` chooses the next branch, and `forkSession`
creates another native session. None implements the current in-place conversation-only
rewind contract. Messages therefore project `rewindable: false`.

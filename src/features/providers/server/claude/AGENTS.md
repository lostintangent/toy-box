# Claude Agent provider

The official Claude Agent SDK runs the owner's installed `claude` executable with its login.
This provider owns no database, sidecar files, or durable metadata.

| Module           | Responsibility                                                   |
| ---------------- | ---------------------------------------------------------------- |
| `provider.ts`    | Native catalogs, creation, resume, history, and deletion         |
| `client.ts`      | CLI discovery, native queries, and their teardown                |
| `connection.ts`  | One live session: sends, steering, model changes, and questions  |
| `projector.ts`   | Live and historical native messages into canonical SessionEvents |
| `history.ts`     | Native transcript reads: history and the session directory       |
| `messages.ts`    | Native text, images, shared system messages, and slash prompts   |
| `models.ts`      | Native model identities and catalog options                      |
| `tools.ts`       | In-process MCP host for supplied Toy Box tools                   |
| `fileChanges.ts` | Native edit hunks into the shared diff format                    |

## Queries

Each attached session is one SDK query; the SDK owns its subprocess and stdio, and short-lived
queries list models and skills. Native creation uses the Sessions-owned UUID through the SDK's
`sessionId` option. Teardown awaits the query's iterator `return()` so the CLI finishes flushing
native history before Sessions deletes it; `close()` starts that cleanup without awaiting it.

## Connection

Sessions keeps queued messages; messages sent while native work is active use Claude's `next`
priority to steer at the next model step. (`now` would instead move running tools to the
background.) Claude surfaces `next` input to the model as text only, so an immediate message with
images uses `later` and runs once the active turn ends instead of losing its images. A send's
native replay carries its clientId.

Model and reasoning effort change together through the session-scoped `applyFlagSettings` API.
Native messages omit effort, so live model changes carry the last one applied.

Stop interrupts with `cancelQueued`, so steers the turn has not reached are cancelled instead of
running as their own turn. The SDK's `interrupt()` type omits that option, a listed native
workaround. An interrupt also ends the running command and background agents, while background
shells the agent launched keep running.

Native permissions follow Toy Box's trusted-owner policy. Connections pin
`permissionMode: "default"` so `canUseTool` applies it; otherwise the owner's native default or
auto mode would. `AskUserQuestion` goes to the shared question UI when the session's role allows
it; each native question is its own tool call and is answered individually.

Enable `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`: native `session_state_changed: idle` follows
background agents and their notifications by default. It does not wait for the main thread's
background shells, and one that finishes later wakes the session.
`CLAUDE_CODE_ENABLE_TODO_TOOLS` keeps native checklists available on newer models.

Flag settings turn on `autoCompactEnabled` whatever the owner's Claude setting, so long
conversations compact as Codex and Copilot sessions do. Model switches merge into those settings,
so the session keeps compacting.

A turn's result reports the context its latest request sent. A compaction's own count omits the
system prompt and tools, so a turn that ends on one, such as `/compact`, or before any request is
measured with the CLI's token-count API before native idle ends it.

`tools.ts` registers the supplied tools with the official MCP SDK in process, passing that
instance to the Agent SDK. There is no HTTP server or custom transport. Full Zod schemas
preserve refinements and recursive JSON fields; use the app's MCP/Zod dependencies because
the Agent SDK's bundled schema converter cannot serialize the current recursive schemas.
Native tool context supplies cancellation and call identity; successful terminal tools use
`claude/endTurn`. Native ToolSearch discovers deferred tools.

The supplied skill directories are native local plugins; standalone `SKILL.md` roots need
no copied files or generated manifests. Claude itself discovers only `.claude/skills`, so a
project's `.agents` directory, when present, also loads as a plugin root, giving Claude the
repository's shared `.agents/skills` that Copilot and Codex read natively. `reloadSkills()`
supplies slash completion.

Creation names use the SDK's `title` option; later names use `renameSession()`. The SDK's
`customTitle` includes generated native titles too, so automatic Toy Box renames preserve
any existing native title.

## Projection

One projection consumes the live stream and SDK-reconstructed history, so a transcript agrees
whether it is watched or reopened.

- **Turns.** Native `session_state_changed: idle` ends work. A `result` is only a turn result
  and must not finish the shared stream; it reports failures and the turn's context usage.
- **Transcript.** The projector alone decides which native messages are transcript. A send's
  replay always is, because Sessions' queue waits for it; a typed local command such as `/cost`
  shows as the command it runs. The CLI writes interruption notices and local command output as
  user text without an origin, and its own API errors and notices, such as "No response
  requested.", as `<synthetic>` model messages; a turn can recover from those errors, and only a
  turn's `result` reports failure. The `task-notification` origin marks internal completion
  prompts. None of these is transcript.
- **Models.** Native messages restate their model; `model_changed` projects only when the main
  thread's or a subagent's model or effort changes, and on each turn's `init`.
- **Tool calls.** A call starts with its `tool_use` and completes with its `tool_result`. Native
  names map to Toy Box's canonical tools, and ToolSearch and omitted Toy Box tools stay hidden.
  Questions, checklists, and background agents retain only the native correlation they require.
  Live background agent cards stay running from native `task_started` through
  `task_notification`, including failed or stopped outcomes; history retains the native launch
  result and child transcript, since the SDK does not replay those live task signals. Unless a
  call says otherwise, the main thread's agents run in the background and a subagent's own agents
  in the foreground. Fork agents (`subagent_type: "fork"`, on by default) inherit the conversation.
- **Inputs.** Images and shared system messages round trip through native history without
  staging files. Artifacts remain entirely owned by Sessions and Files.

## History

`history.ts` uses the SDK's native export into a request-local buffer, then its history APIs
for active-branch and subagent reconstruction. Exported records restore structured tool
results, effort, and API errors that `getSessionMessages()` omits. Replay then matches what the
live stream sent: native history keeps no turn results, so, as in the CLI, a turn whose last
assistant message is an API error restores its failed `result`; native history alone records
each model switch as a `/model` command, which replay drops (an owner-typed `/model` therefore
shows only live); and a fork's transcript opens with the parent message that forked it and the
fork's directive, which replay drops too. Nothing is persisted or mirrored; the buffer is never
installed as a live query's session store.

The SDK replays a transcript only from its latest compaction, so history also replays each earlier
part from the transcript up to the compaction that closed it. Each message replays once, where it
first appeared, since a partial compaction relinks the messages it keeps after its summary; the
summary itself is dropped, as the live stream marks it synthetic. Subagent transcripts still
replay only from their own latest compaction.

The SDK reads a session's `cwd` only from the first 64 KB of its transcript (its branch comes from
the tail), so a large first message, such as a pasted image, leaves the catalog without a
directory. `readDirectory` alone reads the first transcript entry that records one, a listed
native workaround, so resuming such a session does not fall back to the home directory.

## Native limits

Conversation rewind remains unavailable: native `rewindFiles()` changes files, and
`forkSession` creates another native session. A `resumeSessionAt` resume (even with
`resumeDropsTurn`) leaves history unchanged until a new message branches from that point, and a
later plain resume continues the old branch; the CLI's own `rewind_conversation` request is not
exposed by the SDK (checked with SDK 0.3.302). None implements the in-place conversation-only
rewind contract, so messages project `rewindable: false`.

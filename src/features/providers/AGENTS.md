# Providers

The Providers feature owns available models and adapts installed agent CLIs to the shared Sessions
model. Sessions builds on this feature for native execution and history; model selection across
the workspace consumes the same provider-owned catalog and configuration.

- `model/` defines `ModelInfo`, the validated `ModelConfiguration`, model options, and the pure
  normalization, identity, and display helpers shared by every consumer.
- `queries.ts` and `server/functions.ts` expose one catalog of provider statuses and enabled
  models to the browser. A provider is unavailable when its CLI is missing, signed out when its
  runtime has no credentials, and otherwise ready. The workspace route preloads the query during
  SSR and hydrates it through the existing Query integration.
  Provider setting changes, successful CLI update checks, and workspace reconnects invalidate that query.
- `useModels.ts` exposes the catalog and its availability, composing Workspace's default-model
  preference through its settings hooks. `useHasModels` subscribes only to catalog availability.
- `useProviders.ts` combines catalog metadata with Workspace's `disabledProviders` preference.
  An installed provider is enabled unless the owner turns it off; signing out doesn't change that.
  Settings lists every registered provider; the sidebar filter lists enabled providers.
  Its `setEnabled` operation is used by Settings. Claude starts disabled. Sidebar filters are local
  UI state and never change provider enablement.
- `components/ModelPicker.tsx` owns the controlled model and configuration pickers.
- `components/ProviderSettings.tsx` owns enablement, CLI updates, and subscriptions in Settings. Version reads
  share one query for all installed providers while Settings is open, outside catalog loading. Disabled
  providers still show their version but cannot be updated. A signed-out provider is muted and shows
  no plan; its update check also rechecks sign-in. Each enabled, ready provider reads its account's
  subscription through its own query, at most once a minute, so a slow or failed read affects only
  its own row. The plan's name sits beside the version; one Usage toggle reveals every limit.
  `server/cli.ts` owns installation checks through `Bun.which(providerId)` and the shared `--version`
  and `update` commands. Updates compare versions before and after; unchanged does not prove an installation
  is current (some installers require manual updates). Restart Toy Box to use updated runtimes.
- `server/provider.ts` defines `SessionProvider`, `SessionConnection`, and the configuration
  supplied by Sessions. The contract addresses each history by its native ID, and a connection
  exposes the one it runs; Sessions maps public IDs to native ones.
  `isSignedIn` translates the runtime's native credential check. `readSubscription` maps the
  signed-in account's native plan and limits to a `ProviderSubscription`; an account using an API
  key has none.
  `listSessions` lists at least the newest `limit` sessions, and `readSession` reads one without
  listing filters. Both report `NativeSession` metadata with the working directory the history
  records. `delete` resolves when the history is already gone.
  Native SDK and protocol types stay inside their implementations.
- `server/index.ts` registers the providers, aggregates their available catalogs,
  isolates discovery failures, and stops their shared processes on server shutdown.
  `getProviderCatalog` doesn't wait for discovery, so provider startup never holds a page load: a
  provider still being discovered reads as ready without models. `listModels` waits, and
  `getModelChoices` composes its models with the normalized workspace default, optionally scoped to
  one provider. A scoped default is null when the workspace default uses another provider.
  Discovery checks sign-in before reading models and shares one process-wide promise per provider
  until shutdown or a successful CLI update check. Completed discovery broadcasts
  `providers.changed`. Failed discovery is evicted and stays quiet, so the next request retries
  without looping clients, and its provider stays ready. A signed-out provider contributes no models
  but keeps its sessions. Disabled providers are never started to check. Updates evict only that
  provider's discovery and wait for rediscovery, so its broadcast is the one hint that refreshes
  client catalogs and versions.
  Running native processes retain their version until restarted. Restart the server and reload
  the page after installing or removing a provider. Enabled providers are selected outside
  the cache, so toggling one never rediscovers the others. Session catalogs are read independently
  on every request. A provider that cannot discover its catalog contributes no entries and remains
  visible in Settings. Disabling removes discovery and closes its open session panes; it does not
  delete history or stop server work already running.
- `routes/v1/models.ts` exposes `GET /api/v1/models` to external clients as
  `{ models, defaultModel }`. Channels reuses `getModelChoices` for member-scoped
  choices; the HTTP entry point does not introduce another catalog or cache.
- [`server/copilot/`](server/copilot/AGENTS.md) implements the contract through the
  GitHub Copilot SDK.
- [`server/codex/`](server/codex/AGENTS.md) implements it through the Codex app-server.
- [`server/claude/`](server/claude/AGENTS.md) implements it through the Claude Agent SDK.
- [`INTEGRATION.md`](INTEGRATION.md) records the capability inventory and native limits.

Sessions owns public IDs, draft records, native identity, role policy, tools, instructions,
skill installation, artifact locations, connection retention, queues,
completion, and broadcasts. It supplies providers with prepared skill directories,
image inputs, question policy, and tools on creation and resume. Each tool arrives bound to
the public session, validating its arguments and answering with text. Implementations register
it and report a rejection as a native failed call that gives the model the error's message.
Providers must not reach into the Sessions registry, runtime, persistence, or resource layout.

Channel-owned Worker sessions receive composed Agent identity instructions and Channel tools like
any other Session configuration. Providers receive no Agent-specific protocol or metadata.

All providers project into Sessions' `SessionEvent` and use its shared reducer. This model
dependency does not give providers ownership of `SessionState`. Providers report Toy Box tools as
plain tool calls, and Sessions applies their policy over every provider's events, live and on replay.
`delta`, `reasoning_delta`, and `tool_output_delta` carry incremental text. `assistant_message`
supplies complete message text, and `reasoning` replaces the current reasoning text. Native block
assembly belongs in each projector; canonical text never mixes incremental and cumulative semantics.
`context_usage_changed` reports the root conversation's context occupancy against its model's window;
subagent usage is not the parent's and is dropped.
The `retrying` status reports that a root model request failed and the provider is backing off to
retry it, until the root's next output or the turn's end. A subagent's retries stay off the root,
except Claude's CLI reports a background agent's usage-limit wait there.
A provider's `end` notification ends the root's native work, and a subagent's failure surfaces on its
agent call. The session runtime drains its queue before publishing completion. Disconnecting a
browser never disconnects the provider.

`ModelConfiguration.provider` and `Session.provider.id` select the provider;
these shared value fields also distinguish models with the same name across catalogs.
Keep one model configuration and transcript shape across providers and all consumers.
Sessions applies a turn's model with `setModel` only when it differs from the stream's model, and
never announces it. Each provider emits `model_changed` with the model it applies.

## Native workarounds

Code that compensates for a native SDK or CLI defect starts with a `Workaround` comment naming the
version where the defect was seen and when the code can be removed. Each one is listed here, so
check the list whenever a provider is upgraded:

- Claude resume (`server/claude/provider.ts`): the CLI never restores reasoning effort, and it
  restores the model only when it recognizes it, falling back to its default otherwise (seen with
  CLI 2.1.302). Resume starts with the model and effort of the last reply in history instead. A
  session with no successful reply still starts on the CLI default. Remove once the CLI restores
  both itself.
- Claude transcript directory (`server/claude/history.ts`): `getSessionInfo()` reads `cwd` only
  from a transcript's first 64 KB, so a large first message hides it (seen with SDK 0.3.302).
  `readSession` reads the first transcript entry that records one instead. Remove once the SDK
  finds it itself.
- Copilot computer use (`server/copilot/client.ts`): headless SDK servers load no bundled
  plugins (seen through CLI 1.0.105), so the client registers the running CLI version's cached
  computer-use plugin at start and the CLI applies the user's opt-in. Remove when headless servers
  load bundled plugins.
- Claude abort (`server/claude/connection.ts`): `Query.interrupt()` is typed without the
  `cancelQueued` option its runtime sends as `cancel_queued` (seen through SDK 0.3.314), so Stop
  expects a type error to cancel queued steers. Typecheck fails once the SDK types the option.
- Copilot and Claude delete (`server/copilot/provider.ts`, `server/claude/provider.ts`): a history
  that is already gone is reported only in the error's message (seen with Copilot CLI 1.0.108 and
  Claude Agent SDK 0.3.319), so `delete` matches that message to resolve. Remove once each reports
  it with a code.
- Codex abort (`server/codex/connection.ts`): `turn/interrupt` stops only one thread's turn (seen
  with CLI 0.166.0). Stop interrupts each loaded subagent with an empty `turnId`, the app-server's
  startup interrupt, so it needs no subagent turn IDs. Replace it with `thread/interrupt` once
  openai/codex#40953 ships.

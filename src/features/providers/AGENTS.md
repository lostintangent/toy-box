# Providers

The Providers feature owns available models and adapts installed agent CLIs to the shared Sessions
model. Sessions builds on this feature for native execution and history; model selection across
the workspace consumes the same provider-owned catalog and configuration.

- `model/` defines `ModelInfo`, the validated `ModelConfiguration`, model options, and the pure
  normalization, identity, and display helpers shared by every consumer.
- `queries.ts` and `server/functions.ts` expose one catalog of provider installation metadata and
  enabled models to the browser. The workspace
  route preloads the query during SSR and hydrates it through the existing Query integration.
  Provider setting changes, successful CLI update checks, and workspace reconnects invalidate that query.
- `useModels.ts` exposes the catalog and its availability, composing Workspace's default-model
  preference through its settings hooks. `useHasModels` subscribes only to catalog availability.
- `useProviders.ts` combines catalog metadata with Workspace's `disabledProviders` preference.
  Settings lists every registered provider; the sidebar filter lists installed, enabled providers.
  Its `setEnabled` operation is used by Settings. Claude starts disabled. Sidebar filters are local
  UI state and never change provider enablement.
- `components/ModelPicker.tsx` owns the controlled model and configuration pickers.
- `components/ProviderSettings.tsx` owns enablement and CLI updates in Settings. Version reads
  share one query for all installed providers while Settings is open, outside catalog loading. Disabled
  providers still show their version but cannot be updated.
  `server/cli.ts` owns installation checks through `Bun.which(providerId)` and the shared `--version`
  and `update` commands. Updates compare versions before and after; unchanged does not prove an installation
  is current (some installers require manual updates). Restart Toy Box to use updated runtimes.
- `server/provider.ts` defines `SessionProvider`, `SessionConnection`, and the configuration
  supplied by Sessions. Connections expose the provider reference used by `Session.provider`;
  history and resume receive the relevant identity fields from the same `Session` type.
  Native SDK and protocol types stay inside their implementations.
- `server/index.ts` registers the providers, aggregates their available catalogs,
  isolates discovery failures, and stops their shared processes on server shutdown.
  Model discovery shares one process-wide promise per provider until shutdown or a successful CLI
  update check; failed discovery is evicted so the next request can retry. Updates evict only that
  provider's models and broadcast `providers.changed` to refresh client catalogs and versions.
  Running native processes retain their version until restarted. Restart the server and reload
  the page after installing or removing a provider. Enabled providers are selected outside
  the cache, so toggling one never rediscovers the others. Session catalogs are read independently
  on every request. A provider that cannot discover its catalog contributes no entries and remains
  visible in Settings. Disabling removes discovery and closes its open session panes; it does not
  delete history or stop server work already running.
- [`server/copilot/`](server/copilot/AGENTS.md) implements the contract through the
  GitHub Copilot SDK.
- [`server/codex/`](server/codex/AGENTS.md) implements it through the Codex app-server.
- [`server/claude/`](server/claude/AGENTS.md) implements it through the Claude Agent SDK.
- [`INTEGRATION.md`](INTEGRATION.md) records the capability inventory and native limits.

Sessions owns public IDs, draft records, native identity, role policy, tools, instructions,
skill installation, artifact locations, connection retention, queues,
completion, and broadcasts. It supplies providers with prepared skill directories,
image inputs, and question policy on creation and resume. Providers must not reach
into the Sessions registry, runtime, persistence, or resource layout.

Channel-owned Worker sessions receive composed Agent identity instructions and Channel tools like
any other Session configuration. Providers receive no Agent-specific protocol or metadata.

All providers project into Sessions' `SessionEvent` and use its shared reducer. This model
dependency does not give providers ownership of `SessionState`.
`delta` and `reasoning_delta` carry incremental text. `assistant_message` supplies complete message
text, and `reasoning` replaces the current reasoning text. Native block assembly belongs in each
projector; canonical text never mixes incremental and cumulative semantics.
A provider's `end` notification ends native work; the session runtime drains its queue
before publishing completion. Disconnecting a browser never disconnects the provider.

`ModelConfiguration.provider` and `Session.provider.id` select the provider;
these shared value fields also distinguish models with the same name across catalogs.
Keep one model configuration and transcript shape across providers and all consumers.

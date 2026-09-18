# Providers

The Providers feature adapts installed agent CLIs to the shared Sessions model. Sessions builds on
this feature for native execution and history; workflows and UI continue to use Sessions.

- `server/provider.ts` defines `SessionProvider`, `SessionConnection`, native identity,
  and the configuration supplied by Sessions. Native SDK and protocol types stay
  inside their implementations.
- `server/index.ts` registers the providers, aggregates their available catalogs,
  isolates discovery failures, and stops their shared processes on server shutdown.
- [`server/copilot/`](server/copilot/AGENTS.md) implements the contract through the
  GitHub Copilot SDK.
- [`server/codex/`](server/codex/AGENTS.md) implements it through the Codex app-server.
- [`INTEGRATION.md`](INTEGRATION.md) records the capability inventory and native limits.

Sessions owns public IDs, drafts, native-ID bindings, role policy, tools, instructions,
skill installation, attachment and artifact locations, connection retention, queues,
completion, and broadcasts. It supplies providers with prepared skill directories,
attachment storage, and question policy on creation and resume. Providers must not reach
into the Sessions registry, runtime, persistence, or resource layout.

Private Channel Agent sessions receive composed identity instructions and host tools like any other
Session configuration. Providers receive no persistent Agent identity, and ordinary user inputs
carry no Agent metadata.

Both providers project into Sessions' `SessionEvent` and use its shared reducer. This model
dependency does not give providers ownership of `SessionState`.
A provider's `end` notification ends native work; the session runtime drains its queue
before publishing completion. Disconnecting a browser never disconnects the provider.

`ModelConfiguration.provider` and native identity's `providerId` select the provider;
these shared value fields also distinguish models with the same name across catalogs.
Keep one model configuration and transcript shape across providers and all consumers.

Toy Box is a full-stack binary built on the Bun runtime. It uses installed Codex, GitHub Copilot, and Claude Code CLIs through a shared Providers feature, TanStack Start and Nitro for the SSR web, RPC, SSE, and WebSocket server, React and TanStack Router/Query/Store for the client, and Tailwind and Base UI for its design system.

## Architecture

Toy Box's central unit of work is a session that runs on the server and outlives any browser connection. A client can create one with its first prompt, attach to work already running, reconnect from a cursor, or reopen an idle session from history. Multiple clients can observe and control the same session; disconnecting ends only that client's observation.

A public session ID ties together provider history, at most one live runtime, Toy Box metadata and owned resources, and shared client status. A session without a provider is a draft until its first message, and an imported native session uses a provider-prefixed ID. An artifact-first session treats its file as both its preferred pane and the agent's initial subject.

Native provider activity is translated into canonical `SessionEvent`s. One pure reducer builds the same session state for the live server runtime, persisted-history replay, and browser clients, so a transcript agrees whether it is watched live, reconnected, or opened after completion. Active sessions take their truth from the in-memory runtime; idle sessions are reconstructed from durable provider history, with snapshots serving only as a cache.

Automations, Inbox, Hyper, and Workers govern managed-session lifecycles while reusing that same runtime rather than defining alternate execution models. Files open as live, editable editor surfaces that can notify their owning session. Ordered state that a client reduces, such as a session transcript or a channel conversation, travels through a replayable stream per resource. Every other change is an at-most-once hint on one shared update stream per tab, including file changes, and missed hints are recovered from authoritative snapshots or query refetches. That stream is also the tab's connection: server resources a tab holds, such as file watches, attach to it and end with it.

Toy Box currently assumes one trusted, coordinating server process for one owner; it does not provide an authentication boundary or horizontal coordination. Provider history, SQLite metadata, worktrees, and artifact files survive restarts; active execution, replay buffers, workspace coordination, and terminal PTYs do not.

### Feature conventions

A feature contributes to the app by putting the right file in the right place; composition roots discover it, so adding a capability registers nothing elsewhere. Each contribution is keyed by its feature's folder name.

| To                                | A feature adds                                                 | Discovered by                                      |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| Own tables                        | `server/schema.ts`, default-exporting append-only SQL versions | `src/server/database.ts`                           |
| Run at boot                       | `server/startup.ts`                                            | `src/server/plugins/startup.ts`                    |
| Bundle agent skills               | `server/skills/**`                                             | `src/server/plugins/startup.ts`                    |
| Serve `/socket?service=<feature>` | `server/websocket.ts`, default-exporting a `SocketService`     | `src/server/socket.ts`                             |
| Serve HTTP under `/api`           | `routes/`                                                      | `src/features/workspace/routes.ts`                 |
| Publish workspace events          | a `WorkspaceEvents` augmentation in its model                  | TypeScript declaration merging                     |
| Preload and sync client caches    | a default `WorkspaceCache` export from `cache.ts`              | `src/features/workspace/sync.ts`                   |
| Show content in workspace panes   | a `WorkspacePanes` augmentation in its model, and `panes.tsx`  | `src/features/workspace/components/panes/kinds.ts` |

Features broadcast workspace events, and sync applies them to every workspace cache. A feature's cache stays private: anything that applies a workspace event on the client, whether live, optimistic, or confirmed, calls `applyWorkspaceEvent`. Discovery uses `import.meta.glob`, which Vite expands when it builds or serves the app, and Bun expands wherever it loads source outside Vite, including `bun test`. Product decisions stay explicit: which agent tools each session type receives, managed-session ownership, and where a feature appears in the shell's sidebar and commands.

### Subsystem guides

Each guide explains one capability end to end, including its callers in other folders. Read them in order for a first pass, or start with the one that owns your change.

- [`src/features/sessions/AGENTS.md`](src/features/sessions/AGENTS.md): the foundational session model, runtime, registry, SDK projection, browser lifecycle, and presentation
- [`src/features/providers/AGENTS.md`](src/features/providers/AGENTS.md): the native provider contract, catalogs, Copilot, Codex, and Claude implementations, and history projection
- [`src/features/channels/AGENTS.md`](src/features/channels/AGENTS.md): durable shared message buses, membership cursors, delivery policy, artifacts, and channel presentation
- [`src/features/push/AGENTS.md`](src/features/push/AGENTS.md): install registrations, opaque topic subscriptions, lazy publication, and APNs delivery
- [`src/features/workspace/AGENTS.md`](src/features/workspace/AGENTS.md): TanStack application composition, aggregate workspace state, synchronization, pane identity, and layout
- [`src/features/automations/AGENTS.md`](src/features/automations/AGENTS.md): dependable recurring work by scheduling ordinary managed sessions
- [`src/features/inbox/AGENTS.md`](src/features/inbox/AGENTS.md): durable background results presented through ordinary managed sessions
- [`src/features/workers/AGENTS.md`](src/features/workers/AGENTS.md): owner-scoped background work supervised as ordinary managed sessions
- [`src/features/apps/AGENTS.md`](src/features/apps/AGENTS.md): session artifact apps, installed definitions and instances, shared compilation, and the public app capability boundary
- [`src/features/briefs/AGENTS.md`](src/features/briefs/AGENTS.md): strict brief documents, derived specs and plans, editing transitions, presentation, and agent workflows
- [`src/features/whiteboard/AGENTS.md`](src/features/whiteboard/AGENTS.md): host-neutral native SVG documents, transient whiteboard state, gestures, history, and presentation
- [`src/features/files/AGENTS.md`](src/features/files/AGENTS.md): browsable workspace files presented as live, bidirectionally editable surfaces
- [`src/features/terminal/AGENTS.md`](src/features/terminal/AGENTS.md): reconnectable PTYs with mode-aware scrollback that preserves the visible terminal
- [`src/features/screens/AGENTS.md`](src/features/screens/AGENTS.md): native window capture, shared preview references, remote input handoff, and remoting benchmarks
- [`src/cli/AGENTS.md`](src/cli/AGENTS.md): one installable binary that assembles the browser app and Nitro server
- [`browser/AGENTS.md`](browser/AGENTS.md): the browser extension that sends a page and instructions to the Inbox
- [`tests/AGENTS.md`](tests/AGENTS.md): live runtime and historical replay behavior locked against real SDK fixtures

## Writing Great Code

Great code pursues simplicity by placing a rich domain model at the center, decomposing it into clear responsibilities, and applying functional principles to express its behavior directly. Architecture, state, control flow, boundaries, and tests should follow from real requirements and preserve the product experience with as little machinery as possible.

- Domain coherence
  - Define the smallest coherent ontology of concepts and relationships, then use that vocabulary consistently across every subsystem and layer. These become the system's nouns; scrutinize every addition.
  - Express operations over those values as domain verbs (the subsystem's algebra). A subsystem's public surface should expose capabilities rather than incidental types or implementation steps, so consumers and peers ask it for what they mean instead of reaching into its storage or mechanics.
  - Smallest never means less meaning. Each subsystem, a feature folder or a top-level folder like `src/server`, has internal nouns and verbs, which should be as few as possible, and a contract with other subsystems, which plays the role server functions play between server and client and the HTTP API plays for external clients. Keep that contract semantic: never shrink the count by having consumers reach past it into storage or mechanics, and add a noun or verb when the contract needs one.
  - Use that model to make valid states, transitions, true dependencies, expected side effects, and ownership explicit. Prefer one source of truth and representations that exclude invalid combinations when practical.
- Semantic decomposition
  - Decompose the domain into subsystems with independently nameable roles, ownership, and contracts. Each subsystem should expose a coherent capability rather than mirror implementation mechanics.
  - Within each subsystem, give every module and component one semantic responsibility. Create or extract one when it gives a capability a clear owner, removes real repetition, or clarifies composition; inline wrappers that only add indirection inside a subsystem.
  - Grow the system by extension. Before building a capability, look for an existing one in the owning feature, shared modules and components, sibling features, the installed libraries, and the platform, and extend what fits instead of building a parallel version.
  - Within each file, optimize for linear top-to-bottom reading. Establish its role, domain concepts, and common control flow before supporting mechanics and edge cases; comment only to explain a non-obvious role or invariant.
- Functional architecture
  - Within each boundary, implement domain behavior as a pure, referentially transparent core over immutable values, with explicit inputs, outputs, and transitions.
  - Isolate unavoidable effects, including UI animation, persistence, timers, and external communication, at the owning component or module boundary, with explicit lifetimes and failure behavior.
  - Compose subsystems through narrow contracts. Keep policy and orchestration with their owning layer, and share only genuinely generic mechanics.
- Verifiable contracts
  - Encode domain invariants and policy in executable tests. Verify observable behavior, valid transitions, lifecycle outcomes, and boundary guarantees rather than private implementation details or duplicated logic.
  - Concentrate exhaustive coverage around foundational state machines, reducers, policies, codecs, and boundaries where one defect propagates widely. Test leaf consumers when they own distinct behavior, lifecycle, or integration risk.
  - Keep tests deterministic and readable as specifications: order common behavior before edge cases, prove one contract per test, and introduce narrow seams or protocol-faithful fakes only when needed.
- Performance
  - Never regress hot paths. Streams, RPC calls, and cache updates stay at least as fast and lean as they are: no extra round trips, refetches, broadcasts, or re-renders, and no unmeasured entry bundle growth.

For model examples, see [`src/features/providers/server/copilot/projector.ts`](src/features/providers/server/copilot/projector.ts) and [`src/features/providers/server/copilot/projector.test.ts`](src/features/providers/server/copilot/projector.test.ts).

## Definition of Done

Run `bun run check` (format, lint, and typecheck) and `bun run test`, and fix what they report.

## Working As a Team

When several agents share this working tree, as in a Toy Box channel:

- Only the user commits and decides when to restart the server on port 3100. When they ask you to restart it, run `bun run restart` and end your turn; the restart waits for that. Leave git alone, and edit only your area's files that no one else is editing.
- **Fast lane.** A change that stays in your area, needs no plan, and doesn't remove or rename an export goes straight into the tree. If it needs dogfooding, use 3100. It's reviewed after it lands.
- **Full lane.** Everything else is planned in the channel and cleared by a design review and each affected owner before it lands. A change that overlaps another, removes or renames an export, or could break the server is built in a scratch copy, measured there with `bun run domain diff <shared tree>`, applied in one write, and dogfooded on an isolated HOME. A change to process state lands with a 3100 restart.
- Stay focused. Diagnose a bug found along the way and log it in the channel's findings artifact instead of fixing it, unless the change can't ship without it.
- Report evidence, not claims: `bun run domain diff` for the change's size, contracts (subsystem contracts included), nouns, and verbs, plus before-and-after request and event counts for a hot path it touches and the entry bundle size when client definitions change.
- Run the tests for the features you touched instead of the full suite. Before the user commits, the coordinator runs the full suite and reads the whole diff once.

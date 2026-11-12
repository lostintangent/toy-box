# Toy Box CLI

The CLI bundles two parts into one Bun binary: the browser app and the Nitro server that renders and serves it, including server functions and HTTP, SSE, and WebSocket routes. Launch the binary in any working directory and it runs one server process, with no dependencies to install and no services to wire up. The launcher itself (`src/cli/index.ts`) is small on purpose. What deserves explaining in this folder is the composition: how those parts get built and then collapsed into one file. That runs through Vite and Rolldown, then Nitro, then Bun, driven by two `package.json` scripts (`build` and `build:cli`) and configured in `vite.config.ts`.

## Building the binary

`bun run build` runs Vite under Bun. Vite, on the Rolldown bundler, compiles the app for the browser and server, and TanStack Start decides what belongs to each. Most UI components are isomorphic and run on both; `createServerFn` handlers and HTTP route handlers stay in the server graph regardless of which feature owns their source files. The browser build lands in `.output/server/public` so it remains below the server when Bun flattens both into its virtual filesystem.

The server build goes to Nitro. Its `bun` preset turns it into one runnable entry, `.output/server/index.mjs`, that owns SSR, server functions, API and stream endpoints, and the shared `/socket` WebSocket route. Terminal and Screens provide feature-owned handlers behind that route. On its own it is an ordinary Bun server you could run directly.

`bun run build:cli` delegates this composition to `src/cli/build/index.ts`. After the web build,
it writes a temporary, declaration-only `app-type-library/node_modules` tree for the app
compiler. Public app packages come from the shared runtime dependency catalog;
compiler-only and type-support packages are listed alongside the writer. `Bun.build()`
starts at the launcher and follows its dynamic `import()` of the Nitro server and the
chunks it loads. It packs that graph, the browser assets, the app type library, and a
copy of the Bun runtime into one `toy-box` file. The temporary library is removed after
compilation, and the finished binary reads nothing from `.output` or `node_modules` on
disk. The npm package ships only this binary and its metadata, currently for Apple
silicon on macOS; new platforms mean extending the build matrix, not changing the model.

The build also embeds Screens' native helper; [Screens](../features/screens/AGENTS.md) owns its packaging and permission contract.

The shape is fan out, then collapse. `vite build` fans the app into browser and server builds; `Bun.build()` collapses the Nitro server, browser assets, launcher, and Bun runtime into one native file.

Nitro generates gzip and Brotli browser assets. Before its server bundle reads the public asset
manifest, a build hook calls `build/publicAssets.ts` to remove originals with both compressed variants.
Assets without both variants remain unchanged. Production clients must accept gzip or Brotli for
those compressed assets; the server's executable code and SSR bundles are separate and retained.

## Process startup

`src/cli/index.ts` is the entry point when the binary runs. It hands Nitro its port and host. The host defaults to `127.0.0.1`, so only this machine reaches the server directly, and phones and linked servers come through `tailscale serve`. `--host` overrides it, such as `--host 0.0.0.0` for direct LAN access. The Copilot SDK sometimes re-invokes this same binary as a subprocess with a file path as the first argument, so the launcher treats that argument as a working directory only when it is actually a directory. It registers a relaunch on the process registry, which replaces this process with a given command through `process.execve`, passing this run's `--port` and `--host` plus `--no-open`. It then imports the built Nitro server and, for an interactive run, opens the browser unless the user opted out. Nitro owns application startup and shutdown rather than the launcher: `src/server/plugins/startup.ts` installs bundled skills and runs each feature's `server/startup.ts`, such as the terminal runtime, scheduler, and worker cleanup, and calls the cleanup each one returns when the server closes.

## Socket gateway

`src/server/socket.ts` binds each `/socket?service=<feature>` connection, once as
it upgrades, to the hooks of the `SocketService` that feature's
`server/websocket.ts` default-exports, discovered by convention and loaded on first
connection. A service reads what the socket's URL names, so its hooks close over
their subject for the connection's lifetime. Terminal and Screens use it, on
independent physical connections that the client's `connectSocket` keeps open. The
gateway refuses cross-site browsers (see below); features own their protocols and lifetimes. In
production, Nitro serves it. In development, Nitro's in-process runner
upgrades through crossws's Node adapter, which refuses to run on Bun, so
`src/server/socketDevelopment.ts` serves it from a Bun listener in Vite's process,
where RPCs and sockets share the feature runtimes. Bun loads the gateway there outside
Vite and expands its feature glob itself. That listener uses `Bun.serve` rather than
srvx, whose default SIGINT handler would close only the listener and keep Vite
running.

## Cross-site requests

Browsers let any page POST a form to any host and open a WebSocket to any host, so a site open in the owner's browser could otherwise start agents or drive their terminal. A site could also rebind its own name's DNS to this machine and then read Toy Box as its own origin. `src/server/middleware/origin.ts` refuses every request whose `Host` isn't localhost, an IP literal, or a name in `allowedHosts` (Tailscale Serve's `*.ts.net`), the list Vite's dev server also uses. That stops rebinding, because a rebound page still sends the attacker's name, and rebinding needs a name rather than an IP. It also refuses every write (any method but GET, HEAD, or OPTIONS) unless `isTrustedOrigin` admits its `Origin`, and the socket gateway applies both rules to upgrades, which are GETs and, in development, never pass Nitro's middleware. The origin check trusts Toy Box's own host, any browser extension, and a request with no `Origin`, which only non-browser clients send. Server functions pass through it too, and TanStack Start's default CSRF check still guards them.

## Shutdown

Ctrl+C or SIGTERM runs Nitro's `close` hooks, which release long-lived resources
such as provider processes, PTYs and the Screens helper, so the process can exit. In
production, srvx first stops accepting connections. Nitro's `shutdown` hooks then
abort the process-wide `shutdown` signal (`src/shared/server/shutdown.ts`), which
ends every open stream and closes every gateway socket with 1001, so clients
reconnect to whichever server answers next. srvx waits up to 5 seconds for requests
still in flight before Nitro runs the `close` hooks; a second Ctrl+C skips the wait.
In development, Nitro closes Vite and then runs them; this currently takes 5
seconds, because Nitro waits for a shutdown reply that its in-process runner never
sends. Nitro also runs them when Vite restarts, such as after a config edit, so
process-wide runtimes start again on their next use. The startup plugin isolates each
feature's cleanup as it does its startup, because Nitro chains `close` hooks and one
rejection would skip every later one.

## Restart

A restart is that shutdown ending in an exec of the installed release instead of an
exit, so the process keeps its ID, terminal, working directory and environment, and
no supervisor has to bring it back. `restartServer` in
[`installation.ts`](../features/workspace/server/installation.ts) refuses unless the
launcher registered a relaunch and the installed `toy-box` runs, so `bun dev` keeps
running. A 15 second deadline relaunches anyway when a cleanup hangs, so no feature
bounds its cleanup for restart's sake.

A cleanup that signals a child waits for it to exit through
[`stopProcess`](../shared/server/stopProcess.ts), with a SIGKILL after 2 seconds. A child
still running at the exec becomes a zombie of the new image, which never reaps it. Claude's
SDK exposes nothing to wait on, so a restart can leave one zombie per loaded Claude
session until the server exits.

## Invariants

- Build the web app before compiling the launcher, because the binary embeds `.output`.
- Keep native addons (compiled `.node` binaries) off the production runtime path. The published binary ships no `node_modules`, so a dependency that loads a native module at runtime will work in development and then fail in the binary. Tailwind's native compiler is safe because it only runs during the build, not at runtime.
- Keep Nitro's `output.publicDir` and Bun's public asset path aligned at `.output/server/public`, and keep `serveStatic` enabled for production. The non-default nesting is intentional: Bun flattens the compiled server to its virtual root, so Nitro's default sibling `../public` path would escape that root.
- Preserve `app-type-library` as the packaged type-library basename: the standalone compiler resolves it below Bun's `import.meta.dir` virtual root.
- Keep feature sockets on Nitro's origin.
- Keep every GET free of side effects. Every request needs a trusted host, but only writes need a trusted origin.
- Keep launcher policy limited to process configuration, loading Nitro, and relaunching with its own flags. Application lifecycle belongs to server plugins and subsystems.

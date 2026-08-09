# Toy Box CLI

The CLI bundles two parts into one Bun binary: the browser app and the Nitro server that renders and serves it, including server functions and HTTP, SSE, and WebSocket routes. Launch the binary in any working directory and it runs one server process, with no dependencies to install and no services to wire up. The launcher itself (`cli/index.ts`) is small on purpose. What deserves explaining in this folder is the composition: how those parts get built and then collapsed into one file. That runs through Vite and Rolldown, then Nitro, then Bun, driven by two `package.json` scripts (`build` and `build:cli`) and configured in `vite.config.ts`.

## Building the binary

`bun run build` runs Vite under Bun. Vite, on the Rolldown bundler, compiles the app for the browser and server, and TanStack Start decides what belongs to each. Most UI components are isomorphic and run on both; `createServerFn` handlers and HTTP route handlers stay in the server graph regardless of which feature owns their source files. The browser build lands in `.output/server/public` so it remains below the server when Bun flattens both into its virtual filesystem.

The server build goes to Nitro. Its `bun` preset turns it into one runnable entry, `.output/server/index.mjs`, that owns SSR, server functions, API and stream endpoints, and the terminal WebSocket route. On its own it is an ordinary Bun server you could run directly.

`bun run build:cli` delegates this composition to `cli/build.ts`. After the web build,
it writes a temporary, declaration-only `app-type-library/node_modules` tree for the app
compiler. Public app packages come from the shared runtime dependency catalog;
compiler-only and type-support packages are listed alongside the writer. `Bun.build()`
starts at the launcher and follows its dynamic `import()` of the Nitro server and the
chunks it loads. It packs that graph, the browser assets, the app type library, and a
copy of the Bun runtime into one `toy-box` file. The temporary library is removed after
compilation, and the finished binary reads nothing from `.output` or `node_modules` on
disk. The npm package ships only this binary and its metadata, currently for Apple
silicon on macOS; new platforms mean extending the build matrix, not changing the model.

The shape is fan out, then collapse. `vite build` fans the app into browser and server builds; `Bun.build()` collapses the Nitro server, browser assets, launcher, and Bun runtime into one native file.

## Process startup

`cli/index.ts` is the entry point when the binary runs. It reads the HTTP host and port, then turns off Bun's HTTP idle timeout so long-lived streams are not dropped. The Copilot SDK sometimes re-invokes this same binary as a subprocess with a file path as the first argument, so the launcher treats that argument as a working directory only when it is actually a directory. It imports the built Nitro server and, for an interactive run, opens the browser unless the user opted out. Nitro owns application startup and shutdown, including the terminal runtime, bundled skills, scheduler, and worker cleanup; that policy lives under `src/server` rather than in the launcher.

## Invariants

- Build the web app before compiling the launcher, because the binary embeds `.output`.
- Keep native addons (compiled `.node` binaries) off the production runtime path. The published binary ships no `node_modules`, so a dependency that loads a native module at runtime will work in development and then fail in the binary. Tailwind's native compiler is safe because it only runs during the build, not at runtime.
- Keep Nitro's `output.publicDir` and Bun's public asset path aligned at `.output/server/public`, and keep `serveStatic` enabled for production. The non-default nesting is intentional: Bun flattens the compiled server to its virtual root, so Nitro's default sibling `../public` path would escape that root.
- Preserve `app-type-library` as the packaged type-library basename: the standalone compiler resolves it below Bun's `import.meta.dir` virtual root.
- Keep the terminal on Nitro's origin so development, production, and remote access share one transport configuration.
- Keep launcher policy limited to process configuration and loading Nitro. Application lifecycle belongs to server plugins and subsystems.

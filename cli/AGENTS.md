# Toy Box CLI

The Toy Box CLI is a Bun "full-stack binary" that bundles the SSR-enabled web app and terminal WebSocket server in one process. This allows us to distribute a zero-dependency package over NPM, which makes it really easy for users to get started (e.g. `bunx @lostintangent/toy-box`).

## Build / Distribution

- `bun run build` uses Vite to produce an `.output` folder, which includes the React-based web client and the TanStack Start/Nitro server bundle.
- `bun run build:cli` uses Bun to package the CLI launcher, the terminal WebSocket server, and the built web app (above) into a single executable.
- NPM publishes the binary, `package.json`, and `README.md` for acquisition

> Note: At the moment, we only publish binaries for Apple silicon. But once we add other platforms, the above shouldn't conceptually change.

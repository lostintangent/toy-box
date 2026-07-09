# Toy Box CLI

The CLI turns Toy Box's web application, server functions, and terminal runtime into one installable binary. Users can launch that binary in any working directory without installing the application's JavaScript dependencies or coordinating multiple services.

## Process startup

The launcher owns the production process boundary:

- It accepts the host and HTTP port and validates the terminal WebSocket port.
- It changes process working directory only when the positional value is a real directory. SDK internals can invoke the compiled binary with other file arguments that must not become application scope.
- It disables Bun's HTTP idle timeout so long-lived session and update streams remain connected.
- It starts the terminal WebSocket server, passes the resolved port to application runtime configuration, and then starts the built Nitro server in the same process.
- It stops the terminal server on process signals and opens the web UI only for an interactive terminal invocation unless the user opts out.

Development runs Vite and the terminal server as separate processes for reloadability. Production combines them; their ownership and protocols remain independent.

## Build and distribution

`bun run build` asks Vite and TanStack Start to produce `.output`, containing the React client and Nitro server bundle. `bun run build:cli` runs that build first, then compiles the CLI launcher, terminal server, and generated web application into the `toy-box` executable.

The NPM package publishes only that executable and package metadata. The current build target and package constraints support Apple silicon on macOS; adding platforms should extend the build matrix without changing the one-binary runtime model.

## Invariants

- Build the web application before compiling the launcher because the binary embeds `.output`.
- Resolve the terminal port once and share it with both servers and browser runtime configuration.
- Keep startup and shutdown coordination here; application session policy belongs to the server subsystems.

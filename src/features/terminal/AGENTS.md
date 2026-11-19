# Terminal

The terminal runtime lets a shell survive refreshes and short disconnects without losing the PTY or corrupting its visible scrollback. The shared [socket gateway](../../cli/AGENTS.md#socket-gateway) dispatches `/socket?service=terminal` to Terminal's hooks, and `server/runtime.ts` owns process, reconnect, and replay policy.

`model/protocol.ts` defines the validated client control plane shared by both sides. `client/` owns the input it holds while its socket reconnects, the xterm instance, and resize lifetime; `server/` owns the PTY, replay policy, WebSocket handler, and the `startup.ts` that closes live PTYs with the server; and `components/` mounts that capability into React. Workspace owns only whether the terminal is visible and where its shell is placed. Nitro's route adapter and the Vite development proxy remain in their application composition roots.

The xterm-backed component and client runtime stay behind dynamic imports so opening Toy Box does not load the terminal bundle until the terminal is used.

## Protocol

One WebSocket multiplexes a JSON control plane with a binary data plane. Lifecycle commands stay explicit while stdin and stdout avoid a protocol envelope on the hot path.
The shared `/socket` gateway refuses browser pages from another origin before
dispatching to Terminal. Native clients send no Origin and are admitted.

Every browser tab creates a stable `clientId` in session storage. That ID owns zero or one PTY. A socket's URL names its tab's ID and, when known, the terminal's size, and the server reads the owner's configured shell as the socket upgrades. Connecting with the same ID resumes the existing PTY; the newest socket replaces any older connection without temporarily orphaning the process.

### Client control

| Message  | Meaning                                  |
| -------- | ---------------------------------------- |
| `resize` | Resize the active PTY                    |
| `close`  | Explicitly terminate and release the PTY |

### Server control

| Message | Meaning                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- |
| `ready` | The PTY is available; `resumed` distinguishes creation from reconnection and precedes replay |
| `exit`  | The shell process exited and the client should close its terminal surface                    |

Binary client messages are written directly to PTY stdin. The scrollback buffer parses PTY output before the runtime sends those bytes to the active socket. Backpressure protects the server by skipping a socket whose buffered output exceeds the configured limit.

## PTY lifecycle

Creation binds the configured shell, working directory, environment, dimensions, scrollback buffer, and socket to one `clientId`.

A socket disconnect is not an explicit close. The server keeps the PTY for a 30-second orphan window so a refresh can reconnect. A client `close`, an expired orphan window, or process exit releases it. A shell that is attached but quiet stays alive, since Bun's socket pings close a vanished client's socket and start its orphan window. The runtime also caps concurrent PTYs to protect the single-user server process.

Closing a PTY hangs up and signals its shell, and kills it if it's still running after 2 seconds. Server shutdown closes every PTY and waits for their shells to exit, so the server reaps them.

The terminal identity and reconnect contract deliberately differ from agent sessions: a terminal belongs to one tab-scoped client ID, accepts one current socket, and replays terminal display state rather than domain events.

## Replay

The scrollback buffer uses headless xterm with the same scrollback limit and Unicode version as the browser. After `ready`, a resuming socket receives the parsed screen and scrollback, including the alternate screen and its modes. Output still queued in xterm goes to the current socket as it is parsed, so the replay needs no separate queue.

**xterm workaround.** `@xterm/addon-serialize` 0.14.0 omits cursor visibility, SGR mouse encoding, and the active scroll margins. `ScrollbackBuffer` restores them from xterm 6's internal state and restores the cursor position after setting margins or origin mode. Recheck on xterm upgrades. Remove each restore when the serializer itself restores that state without moving the cursor.

A replay loses OSC 8 link targets, the cursor shape, a held line-drawing character set, and a scroll region set on the normal screen while a full-screen app runs. The browser answers queries it receives live, but terminal queries already parsed while disconnected are not replayed. If a sequence or UTF-8 character spans the parsed and unparsed output, the reconnecting browser can display stray characters. This does not change the buffer's parsed screen.

## Invariants

- Send `ready` before any replay so the client can initialize its terminal surface first.
- Install a replacement socket before closing the previous one so delayed close events cannot start an orphan timer.
- Treat disconnect and explicit close as different lifecycle events.
- Keep terminal replay and session-event replay as separate protocols with separate state machines.

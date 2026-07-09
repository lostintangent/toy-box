# Toy Box Terminal Server

The terminal server lets a shell survive refreshes and short disconnects, so users can run commands from desktop or phone without losing the PTY or corrupting its visible scrollback. It is a separate runtime because terminal traffic is bidirectional binary I/O with PTY-specific replay, not canonical session events. Production starts it beside Nitro in the same Toy Box binary; development runs it independently.

## Protocol

One WebSocket multiplexes a JSON control plane with a binary data plane. Lifecycle commands stay explicit while stdin and stdout avoid a protocol envelope on the hot path.

Every browser tab creates a stable `clientId` in session storage. That ID owns zero or one PTY. Connecting with the same ID resumes the existing PTY; the newest socket replaces any older connection without temporarily orphaning the process.

### Client control

| Message  | Meaning                                                              |
| -------- | -------------------------------------------------------------------- |
| `init`   | Create or resume the client's PTY with optional dimensions and shell |
| `resize` | Resize the active PTY                                                |
| `close`  | Explicitly terminate and release the PTY                             |

### Server control

| Message | Meaning                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- |
| `ready` | The PTY is available; `resumed` distinguishes creation from reconnection and precedes replay |
| `exit`  | The shell process exited and the client should close its terminal surface                    |

Binary client messages are written directly to PTY stdin. PTY output is stored for reconnect and written directly to the active socket. Backpressure protects the server by skipping a socket whose buffered output exceeds the configured limit.

## PTY lifecycle

Creation binds the configured shell, working directory, environment, dimensions, scrollback buffer, and socket to one `clientId`. Input, output, and resize mark the PTY active.

A socket disconnect is not an explicit close. The server keeps the PTY for a 30-second orphan window so a refresh can reconnect. A client `close`, an expired orphan window, 30 minutes of inactivity, or process exit releases it. The manager also caps concurrent PTYs to protect the single-user server process.

The terminal identity and reconnect contract deliberately differ from agent sessions: a terminal belongs to one tab-scoped client ID, accepts one current socket, and replays terminal display state rather than domain events.

## Mode-aware scrollback

Raw byte replay can corrupt full-screen applications, so the scrollback buffer interprets the ANSI state needed to reconstruct the terminal safely. It tracks private-mode changes, alternate-buffer entry and exit, scrollback clearing, and full reset.

- In normal mode, reconnect replays private-mode state followed by normal scrollback output.
- In alternate mode, reconnect replays only alternate and private-mode state. It never injects normal scrollback into the full-screen buffer and requests a redraw when needed.

## Invariants

- Send `ready` before any replay so the client can initialize its terminal surface first.
- Install a replacement socket before closing the previous one so delayed close events cannot start an orphan timer.
- Treat disconnect and explicit close as different lifecycle events.
- Keep terminal replay and session-event replay as separate protocols with separate state machines.

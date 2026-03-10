# Toy Box Terminal Server

Toy Box runs a dedicated terminal backend that manages PTY sessions over
WebSockets. A seperate server is needed because TanStack Start doesn't currently support WebSocket API routes. But once it does, we'll merge this capability into the main backend 👍

## Server Protocol (WebSockets)

While the terminal server uses WebSockets as its wire protocol, Toy Box has a simple client<->server application protocol it uses for managing terminals. The protocol is split into control plane messages (which a JSON commands/events), and data plane messages (which are binary terminal I/O). This allows us to minimize overhead in the hot paths (stdin/stdout), while multi-plexing the terminal lifecycle within the same socket channel.

### Session identity

Every client generates a unique `clientId` which is used to assign them a terminal. Each client can have 0 or 1 terminals, and upon connect/resume, we create or attach to their respective PTY.

### Client->Server (Control)

| Message  | Purpose                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`   | Creates or resumes a PTY for the client, using an initial size (row/cols), and optionally, a user-specified shell (defined in settings).            |
| `resize` | Resizes the cols/rows of the client's PTY. This happens whenever the end-user resizes the Toy Box integrated terminal panel.                        |
| `close`  | Close the PTY for the client. This happens when the user clicks the `X` button in the integrated terminal, which explicitly terminates the session. |

### Server->Client (Control)

| Message | Purpose                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ready` | Notifies the client that their PTY is ready. The message includes a `resumed` property which indicates whether it's a new or resumed PTY. Upon resume, the server will send the `ready` event directly before sending the replayed buffer. |
| `exit`  | Notifies the client that their PTY has exited and should be closed. This happens when the user runs `exit` from the root shell.                                                                                                            |

### Client<->Server (Data)

When the server encounters a binary message, it treats it as stdin content and directly writes it to the PTY. Additionally, when the PTY emits output, the server directly writes it to the client's socket as a binary message with no protocol envelope.

## Terminal Lifecycle

### Creation and active use

- Client sends an `init` message, along with their size and shell
- Client input and resizes are forwarded to PTY
- PTY output is streamed back to the active socket

### Disconnect/Reconnect

- Client socket disconnects (e.g. refreshing a browser tab)
- Server detects disconnect and starts a `30s` orphan timer
- Client connects within the orphan timer window, and the server resumes the existing PTY
- Server replays the current scrollback buffer _(see below for details)_

### Client Close

- Client-sent `close` message destroys PTY immediately
- Orphan timeout destroys PTY if no client reconnects
- Idle timeout destroys long-inactive PTYs

### Buffer Replay

- replay exists to preserve terminal continuity after reconnects without
  corrupting display state
- server parses key ANSI control sequences to track active buffer mode and
  private mode state, so replay is mode-aware rather than raw byte dumping
- tracked control classes include:
  - private mode set/reset (`CSI ? ... h/l`), e.g. cursor hide/show modes
  - alternate buffer enter/exit
  - clear scrollback
  - full terminal reset
- on resume in normal mode:
  - replay private mode state
  - replay normal scrollback output
- on resume in alternate mode:
  - replay alternate/private mode state only
  - avoid replaying normal scrollback into the alternate screen
  - poke redraw when needed so full-screen apps repaint correctly

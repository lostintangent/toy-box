# Screens

Screens lets people view and control the host's displays and windows. Displays
include the desktop and menu bar; a window shows only itself. Separate dialogs,
panels and popovers are separate windows while open, not application-scoped views.
Closing a pane never quits the source application.

`model/` holds what the browser and server share: screens and their statuses,
frames, input and the socket protocol. `server/` owns the runtime, the native
helper process and the agent tool, and `native/` is the macOS helper itself.
`client/` holds the pane, the hover preview, the screen browser and the hooks
behind them. `bench/` measures delivery.

## Lifecycle

Screens costs nothing until someone uses it. Four things have lifetimes, each
living inside the one before it:

- The **runtime** (`server/runtime.ts`) is the server's registry of captures,
  their viewers and the one viewer in control. It exists from server startup and
  survives development reloads, so changes to it or the helper take effect after a
  server restart. On its own it holds nothing and starts nothing.
- The **helper** is the one native process that captures screens, takes thumbnails
  and sends input. The runtime starts it on first use, when the screen browser lists
  screens, an agent calls `list_screens` or a viewer connects, then keeps it
  running, idle, between uses. When the server stops or Vite restarts,
  `server/startup.ts` closes the runtime: viewers close and reconnect, and the
  helper releases held input and exits. If the helper fails, its captures end and
  the next use starts another. In development, starting it first compiles the
  source if it changed since the last build.
- A **capture** is one ScreenCaptureKit stream for one screen, shared by everyone
  viewing it. Its first viewer opens it, resolving the screen's ID anew, and its
  last viewer stops it on leaving. It ends early when its display or window goes
  away.
- A **viewer** is one socket, held by one visible canvas: a screen pane or the
  hover preview. It stays open while its pane is visible and the page is in the
  foreground, so hiding the pane, switching tabs or locking a phone closes it. A
  dropped socket reconnects unless its screen ended, and a client that vanishes
  without closing is detached by the WebSocket ping within 30 seconds.

The screen browser never opens a capture. Each time it opens, its search starts
empty, it lists screens, and each card asks the helper for a fresh thumbnail. React
Query keeps the last list and thumbnails for five minutes after the browser closes,
so reopening shows them while fresh ones load; the server caches nothing. Picking a
screen opens a pane whose viewer opens or joins that screen's capture, and closing
the pane stops the capture unless someone else is still watching.

## Discovery and presentation

The helper and `listScreens` return `{ displays, windows }`. Windows are ordinary
windows only: desktop widgets, the menu bar and overlays sit on other window layers.
Displays are always listed; the tool and the screen browser share
`filterScreenWindows` over title and app name. The sidebar's Browse menu opens the
screen browser, `ScreenBrowserDialog`, in both layouts. It searches locally and
shows each screen as a JPEG thumbnail, 960 pixels at most. Picking one opens it
through the workspace's ordinary `openRoot` verb.
Agents have only `list_screens`. They present a display or window with
`set_session_preview`, clear it with `null`, or use the channel preview as lead.
Automation belongs to provider computer-use tools or playwright-cli, not Screens.
Previews retain only IDs; frames, thumbnails and input never enter history or SQLite.

IDs are `display:<displayID>` and `window:<windowID>:<pid>:<process-start>`.
Kernel process-start time prevents a saved ID from following a reused process.
A viewer's socket names its screen in its URL. A screen that ends or can't open
sends its viewers an ended state with the reason, then closes them; viewers
reconnect after any other close, including a server restart.
There is no share, Stop or session ownership.

## Human control

One viewer controls the host. Taking control releases held input and raises the
exact window; a display neither activates an app nor requires foreground identity.
Window input fails if its app loses focus. Input maps through the latest frame
to the current window bounds, including during resize. Blur, disconnect, capture
suspension and explicit release release held input, as does the helper exiting.
This is trusted-owner host access, not an application sandbox or auth boundary.
The shared socket gateway enforces same-origin access.

`useScreen` owns each visible canvas's connection and renderer. Its status is
connecting until a frame is drawn, then live, paused or ended; the pane shows the
shared `PaneMessage` for every status but live, and Try again reconnects an ended
screen. `useScreenKeyboard` sends desktop keys, paste and composition, and its
hidden textarea brings up a phone's keyboard. `useScreenPointer` routes pointer input.
Pinch zooms the local view in every mode, and pan does too while viewing; in
control, one-finger touch, mouse, pen and scroll reach the host. A touch waits for
lift, 10 CSS pixels of movement or 150 ms before pressing. A second finger before
then selects local pinch/pan until all fingers lift; after it, the finger is ignored.
Cancelling a waiting touch sends nothing; cancelling a press releases it.
Safari gesture events are ignored while pointers are down.
macOS lock suspends capture until the host is unlocked.

## Media and ownership

Native code owns capture, geometry, JPEG encoding and OS input. The runtime owns
captures, delivery and control. The browser paints frames and acknowledges them
after drawing. The binary embeds the helper as one executable and extracts it once
per version, by content hash; permissions belong to the app launching Toy Box.
The server ends the helper by closing its stdin, so it answers what it was sent and
releases held input before exiting; its open pipes would otherwise keep the server
running. It ignores a terminal's Ctrl+C, which reaches the server's whole process
group, and its stdin also closes whenever the server process ends.
The helper runs commands (start, stop, focus, input and release) one at a time, in
the order sent. Lists and thumbnails touch no capture or held input, so they run
alongside, and a screen picked from the browser never waits behind its thumbnails.
A stream that stops before it finishes starting fails its start, so one broken
capture never stalls the commands queued behind it. macOS's capture service tells
clients apart by executable path, so only one helper per path can capture at a
time: a second server from the same checkout has its streams interrupted.
Accessibility is used only to match and raise a window for human control.

Frames and thumbnails are JPEG, the only format macOS encodes fast enough for live
frames; formats that keep transparency measured 4–20× slower. A window's rounded
corners are its shape: when a window's geometry changes, the helper measures their
radius from how much of the frame's first row is see-through and sends it with every
frame, and viewers erase the corners after drawing, so their own background shows
there in either theme. Anything else see-through flattens to white, the JPEG
encoder's fastest path; flattening onto any other color measured 2–3.5 ms slower
per frame. Thumbnails skip the radius: at card size a window's corners are a few
pixels, mostly under the card's own rounding.

Packets contain two 32-bit big-endian lengths, JSON metadata, then JPEG bytes. The
runtime forwards frame packets to viewers unchanged.
All screens use 30 fps, JPEG quality 0.7 and maximum 3840x2400 pixels, never exceeding
the native backing scale. Full-frame updates cost more bandwidth; regions keep
small changes cheap and slow viewers skip to the newest image. Bounds follow
window resize. Identical pixels send nothing. Changed regions align outward to
16-pixel blocks and apply to the latest full frame, never another region.
Unchanged rows use `memcmp`; changed rows extend the bounds already found using
16-pixel comparisons, rather than locating individual changed pixels.
On continuous frames, small ScreenCaptureKit dirty bounds narrow the unchanged
check. Baseline comparison searches those bounds plus the previously sent region,
so persistent differences and reversions remain correct. Dirty rectangles are
already in encoded pixels, even for scaled capture. Missing or unusable metadata,
search bounds over 40%, and discontinuous complete-frame timestamps retain the
whole-image block scan. Gaps matter: after backpressure, OS damage can omit changes
from skipped frames. Slow, isolated updates conservatively use that full scan too.
Changes over 40%, new geometry or resuming capture send a new full frame. An empty region restores
it. The client redraws its full frame before each region, so skipped updates
cannot leave stale pixels. Reconnect sends the current full frame before the latest
region. Three unacknowledged frames per viewer bound delivery without a round-trip
FPS cap; slow viewers receive only the newest update. Pipe backpressure bounds
native output.

`bun run src/features/screens/bench/browser.ts test-results/screen-browser.json`
drives headed native capture with counting peers: 5 seconds static sends nothing,
ten clicks reach the next frame within 250 ms p95, full-canvas scrolling delivers
at least 27 fps and at most 1.28 MB/frame at 2560x1600 (about 25% above the measured
1.02 MB). A 32px spinner stays within 10 KB/frame, as does a second 32px canvas that
animates without redrawing the main canvas. Both sparse workloads require 27 fps;
50 ms delayed ACKs still deliver at least 25 fps. This measures frame receipt,
not browser draw or scanout.

Add `--compare` to time full-image blocks and adaptive dirty bounds on identical
captured buffers and baselines. It alternates evaluation order and fails on any
output difference, including unchanged frames and empty baseline restores.
Comparison mode adds independently changing/reverting patches; it does not take
native control or test input (`input` is `null`). The normal command retains the
native-input check.

Add `--display=display:<id>` to capture a listed display instead of the window:
display damage can be precise even when Chromium's window damage is full-frame.
The motion byte budget scales by captured pixel area; the other performance
budgets remain unchanged, and unrelated desktop changes count. Add
`--compare --stall-ms=350` to deliberately stall every 30 captured frames and
verify damage coverage through backpressure. This explicitly labeled
`coverage-stress` mode checks capture errors and output equality, not delivery
performance. Keep the desktop idle during performance measurements: browser
chrome and other display activity are captured changes.

The JSON contains `runs`, each with delivery metrics, explicit budget `failures`,
and native comparison, image conversion/JPEG, pipe write and pixel-copy timing
distributions per workload. Raw native samples retain search areas, frame
timestamps, continuity, geometry/resume flags and paired matches. Native CPU is
measured over the entire capture, including warmups; 100% means one CPU core.
With `paired: true`, CPU and aggregate comparison time include both detectors, not shipping
cost; compare `blockComparisonMs` with `adaptiveComparisonMs` instead.
Failed budget checks still save their reports and fail the command.
The instrumented helper and its pixel oracle are
compiled only for benchmarks. Each capture uses its own temporary executable path,
so it does not interrupt a dev server's existing macOS capture service; normal
capture has no profiling clocks or algorithm switches.

`bun test src/features/screens/native/pixels.test.ts` compiles the native
detectors and compares their output for every single-pixel position across
aligned and unaligned dimensions, padded rows, persistent changes, reversions
and full-frame baseline resets. It also checks dirty metadata validation, global
block alignment, gap fallback and adaptive sequences against the pixel oracle.

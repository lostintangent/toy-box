import { useEffect, useRef, useState } from "react";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { socketUrl } from "@/shared/socket";
import type { FrameSize, ScreenFrame, ScreenInput, ScreenStatus } from "../model";
import {
  decodeScreenPacket,
  type ScreenClientMessage,
  type ScreenServerMessage,
} from "../model/protocol";

/** What one viewer knows about the screen its canvas shows. */
type ScreenState = {
  /** What the server last said, unknown until it answers a new connection. */
  status?: ScreenStatus;
  title?: string;
  /** Why the screen is paused or ended. */
  reason?: string;
  hasControl: boolean;
  hasFrame: boolean;
  /** The server's latest refusal, until this viewer reconnects or takes control again. */
  error?: string;
};

const CONNECTING: ScreenState = { hasControl: false, hasFrame: false };

/**
 * Shows a screen on a canvas while its pane and the page are visible, and sends input to
 * the host while this viewer has control. Every visible canvas has its own connection.
 */
export function useScreen(screenId: string, isVisible: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connectionRef = useRef<ScreenConnection>(undefined);
  const [state, setState] = useState(CONNECTING);
  /** Each retry connects again, which reopens a screen that ended. */
  const [attempt, setAttempt] = useState(0);
  const isPageVisible = usePageVisibility();
  const isShown = isVisible && isPageVisible;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isShown) return;
    const connection = connectScreen(screenId, canvas, setState);
    connectionRef.current = connection;
    // Leaving the browser window lets go of control, so no key or button stays down on the host.
    const release = () => connection.releaseControl();
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      connection.close();
      connectionRef.current = undefined;
      setState(CONNECTING);
    };
  }, [screenId, isShown, attempt]);

  const status = statusOf(state);
  return {
    canvasRef,
    status,
    /** Known once the screen opens. */
    title: state.title,
    /** Why the screen is paused or ended. */
    reason: state.reason,
    error: status === "live" ? state.error : undefined,
    hasControl: state.hasControl,
    takeControl: () => connectionRef.current?.takeControl(),
    releaseControl: () => connectionRef.current?.releaseControl(),
    input: (actions: ScreenInput[]) => connectionRef.current?.input(actions),
    retry: () => setAttempt((count) => count + 1),
  };
}

/** A paused or ended screen says so; otherwise it's live once a frame is on the canvas. */
function statusOf({ status, hasFrame }: ScreenState): "connecting" | ScreenStatus {
  if (status === "paused" || status === "ended") return status;
  return hasFrame ? "live" : "connecting";
}

type ScreenConnection = ReturnType<typeof connectScreen>;

/** A lost connection retries after 250 ms, doubling up to 4 s until the server answers. */
const FIRST_RETRY_MS = 250;
const LAST_RETRY_MS = 4000;
/** Frames refit once the canvas holds still this long, since panes animate into place. */
const RESIZE_SETTLE_MS = 150;

/**
 * One viewer's socket to a screen. Frames are drawn in order and acknowledged once drawn,
 * and the socket reconnects until the screen ends or the viewer closes it. Nothing here
 * throws: without control or a connection, input has nowhere to go and is dropped.
 */
function connectScreen(
  screenId: string,
  canvas: HTMLCanvasElement,
  onChange: (state: ScreenState) => void,
) {
  const renderer = createRenderer(canvas);
  let state = CONNECTING;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = FIRST_RETRY_MS;
  let size: FrameSize | undefined;
  let settling: ReturnType<typeof setTimeout> | undefined;
  const resizing = new ResizeObserver(resize);
  // Zoom is the canvas's transform, which no ResizeObserver sees.
  const zooming = new MutationObserver(resize);
  /** The newest pointer move, sent on the next animation frame. */
  let move: ScreenInput | undefined;

  function update(change: Partial<ScreenState>) {
    state = { ...state, ...change };
    onChange(state);
  }
  function send(message: ScreenClientMessage) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function open() {
    const url = socketUrl("screens");
    url.searchParams.set("screen", screenId);
    const current = (socket = new WebSocket(url));
    current.binaryType = "arraybuffer";
    let drawing = Promise.resolve();
    // The server forgets a closed socket's size, so each new one sends it again.
    size = undefined;
    current.onopen = resize;

    current.onmessage = ({ data }) => {
      if (current !== socket) return;
      if (typeof data === "string") return receive(JSON.parse(data));
      drawing = drawing
        .then(() => draw(current, new Uint8Array(data)))
        .catch((error: unknown) => {
          // A frame that can't be drawn breaks the image, so start over with a new socket.
          console.error("Unable to draw a screen frame:", error);
          current.close();
        });
    };

    current.onclose = () => {
      if (current !== socket) return;
      socket = undefined;
      renderer.clear();
      // A screen that ended said so before its socket closed. Any other close reconnects.
      if (state.status === "ended") return;
      update({ status: undefined, hasControl: false, hasFrame: false, error: undefined });
      retry = setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 2, LAST_RETRY_MS);
    };
  }

  function receive(message: ScreenServerMessage) {
    if (message.type === "error") return update({ error: message.message });
    const { title, status, reason, hasControl } = message;
    retryDelay = FIRST_RETRY_MS;
    update({
      title,
      status,
      reason,
      hasControl,
      error: hasControl && !state.hasControl ? undefined : state.error,
    });
  }

  /** Frames draw one at a time and in order; each is acknowledged once it's on the canvas. */
  async function draw(current: WebSocket, packet: Uint8Array) {
    const { metadata, payload } = decodeScreenPacket(packet);
    const frame = metadata as ScreenFrame;
    const image = payload.length
      ? await createImageBitmap(
          new Blob([payload as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
        )
      : undefined;
    if (current !== socket) return image?.close();
    renderer.draw(frame, image);
    if (!state.hasFrame) update({ hasFrame: true });
    send({ type: "ack", sequence: frame.sequence });
  }

  function sendMove() {
    if (move && state.hasControl) send({ type: "input", actions: [move] });
    move = undefined;
  }

  /** Fits frames to the canvas as shown: its own zoom counts, an ancestor's animation doesn't. */
  function resize() {
    clearTimeout(settling);
    settling = setTimeout(() => {
      const scale = new DOMMatrixReadOnly(canvas.style.transform).a * devicePixelRatio;
      const width = Math.round(canvas.clientWidth * scale);
      const height = Math.round(canvas.clientHeight * scale);
      // A canvas with no area, like a pane yet to grow in, isn't shown.
      if (!width || !height || socket?.readyState !== WebSocket.OPEN) return;
      if (width === size?.width && height === size.height) return;
      size = { width, height };
      send({ type: "resize", size });
    }, RESIZE_SETTLE_MS);
  }

  open();
  resizing.observe(canvas);
  zooming.observe(canvas, { attributeFilter: ["style"] });
  return {
    takeControl() {
      send({ type: "take-control" });
    },
    releaseControl() {
      if (!state.hasControl) return;
      send({ type: "release-control" });
      update({ hasControl: false });
    },
    /** Sends input while in control. Pointer moves coalesce to one per animation frame. */
    input(actions: ScreenInput[]) {
      if (!state.hasControl) return;
      const [first] = actions;
      if (actions.length === 1 && first?.type === "pointer" && first.phase === "move") {
        if (!move) requestAnimationFrame(sendMove);
        move = first;
      } else {
        sendMove();
        send({ type: "input", actions });
      }
    },
    close() {
      clearTimeout(retry);
      clearTimeout(settling);
      resizing.disconnect();
      zooming.disconnect();
      const current = socket;
      socket = undefined;
      current?.close();
      renderer.clear();
    },
  };
}

/**
 * Paints frames on a canvas. A full frame replaces the image; a region is painted over the
 * latest full frame, so regions skipped by a slow viewer never leave stale pixels behind. A
 * window's rounded corners are erased once it's painted, so whatever is behind the canvas
 * shows there.
 */
function createRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d")!;
  let full: ImageBitmap | undefined;
  return {
    draw(frame: ScreenFrame, image: ImageBitmap | undefined) {
      if (!frame.region) {
        full?.close();
        full = image;
      }
      if (!full) throw new Error("A screen region arrived before its full frame.");
      if (canvas.width !== full.width) canvas.width = full.width;
      if (canvas.height !== full.height) canvas.height = full.height;
      context.drawImage(full, 0, 0);
      if (frame.region && image) {
        context.drawImage(image, frame.region.x, frame.region.y);
        image.close();
      }
      if (frame.radius) eraseCorners(context, frame.radius);
    },
    clear() {
      full?.close();
      full = undefined;
    },
  };
}

/**
 * Erases the canvas outside a window's rounded corners. Only the corners are touched, which
 * costs nothing next to clipping every frame to the window's shape.
 */
function eraseCorners(context: CanvasRenderingContext2D, radius: number) {
  const { width, height } = context.canvas;
  // Each corner of the canvas, and where its quarter circle is centered and begins.
  const corners: [x: number, y: number, centerX: number, centerY: number, start: number][] = [
    [0, 0, radius, radius, Math.PI],
    [width, 0, width - radius, radius, 1.5 * Math.PI],
    [width, height, width - radius, height - radius, 0],
    [0, height, radius, height - radius, 0.5 * Math.PI],
  ];
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  for (const [x, y, centerX, centerY, start] of corners) {
    context.moveTo(x, y);
    context.arc(centerX, centerY, radius, start, start + Math.PI / 2);
    context.closePath();
  }
  context.fill();
  context.restore();
}

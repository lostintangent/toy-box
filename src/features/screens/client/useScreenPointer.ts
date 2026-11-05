import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { MAX_FRAME_SIZE, type ScreenInput } from "../model";
import type { useScreen } from "./useScreen";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** How far the canvas is zoomed into its pane, and where it's panned to. */
export type Zoom = { scale: number; x: number; y: number };
export const UNZOOMED: Zoom = { scale: 1, x: 0, y: 0 };

/** Scales a zoom by `factor` while moving the pane point under `from` to `to`. */
type ZoomStep = { factor: number; from: Point; to: Point };

/**
 * Pointer input on a live screen. A pinch zooms the canvas locally in every mode, and while
 * viewing, a drag or scroll pans it. In control, mouse, pen, scroll and one-finger touch
 * drive the host instead.
 */
export function useScreenPointer({
  canvasRef,
  status,
  hasControl,
  input,
}: ReturnType<typeof useScreen>) {
  const zoom = useRef(UNZOOMED);
  const send = useEffectEvent((action: ScreenInput) => input([action]));
  const isLive = status === "live";

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const pane = canvas?.parentElement;
    if (!isLive || !canvas || !pane) return;
    return routePointers(canvas, pane, { zoom, hasControl, send });
  }, [canvasRef, isLive, hasControl]);
}

/** What the pointers that are down are doing. */
type Gesture =
  /** Zooming or panning the canvas, anchored when its pointers last joined or left. */
  | { kind: "zoom"; points: Map<number, Point>; start: Zoom; pinch: Pinch }
  /** In control, a touch that hasn't yet shown whether it presses the host or pinches. */
  | { kind: "pending"; down: PointerEvent; latest: PointerEvent; hold: Timeout }
  /** A button held down on the host. */
  | { kind: "press"; pointerId: number; button: number };
type Timeout = ReturnType<typeof setTimeout>;

/** Where the pointers are centered on the pane, and how far apart they are. */
type Pinch = { center: Point; distance: number };

/** CSS pixels a pending touch moves to become a drag on the host. */
const DRAG_DISTANCE = 10;
/** How long a still, pending touch waits to press the host. */
const HOLD_MS = 150;

/** Safari's trackpad pinch event, which the DOM types don't include. */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

/**
 * Routes the pane's pointer, wheel and gesture events until the returned cleanup. A touch in
 * control waits until it lifts, moves or holds before it presses the host, so that a pinch
 * never presses anything.
 */
function routePointers(
  canvas: HTMLCanvasElement,
  pane: HTMLElement,
  {
    zoom,
    hasControl,
    send,
  }: { zoom: RefObject<Zoom>; hasControl: boolean; send: (action: ScreenInput) => void },
): () => void {
  let gesture: Gesture | undefined;
  /** Safari's trackpad pinch, from where it began. */
  let trackpadPinch: { start: Zoom; center: Point } | undefined;
  /** Where the host pointer last was, so a press that ends off the frame releases there. */
  let hostPosition: Point = { x: 0.5, y: 0.5 };

  function onPointerDown(event: PointerEvent) {
    // Viewing pans with the primary button; control presses any of the host's three buttons.
    if (event.button > (hasControl ? 2 : 0)) return;
    event.preventDefault();
    pane.setPointerCapture(event.pointerId);
    if (gesture?.kind === "zoom") return joinZoom(event, gesture.points);
    // A second finger arrived before the first one pressed anything, so they pinch.
    if (gesture?.kind === "pending") {
      clearTimeout(gesture.hold);
      return joinZoom(event, new Map([[gesture.down.pointerId, centered(gesture.latest)]]));
    }
    if (gesture?.kind === "press") return; // Nothing joins a press on the host.
    if (!hasControl) joinZoom(event);
    else if (event.pointerType === "touch") pend(event);
    else press(event, event.button);
  }

  function onPointerMove(event: PointerEvent) {
    if (gesture?.kind === "zoom") {
      if (!gesture.points.has(event.pointerId)) return;
      gesture.points.set(event.pointerId, centered(event));
      const { start, pinch } = gesture;
      const now = measurePinch([...gesture.points.values()])!;
      // The pointers' spread scales the canvas and their center pans it. One pointer only pans.
      return zoomCanvas(start, {
        factor: pinch.distance ? now.distance / pinch.distance : 1,
        from: pinch.center,
        to: now.center,
      });
    }
    if (gesture?.kind === "pending" && event.pointerId === gesture.down.pointerId) {
      gesture.latest = event;
      const { clientX, clientY } = gesture.down;
      // A drag presses where the touch began, then the host follows it.
      if (Math.hypot(event.clientX - clientX, event.clientY - clientY) >= DRAG_DISTANCE)
        commit(gesture.down);
    }
    const pressing = gesture?.kind === "press" && event.pointerId === gesture.pointerId;
    const hovering = hasControl && !gesture && event.pointerType !== "touch";
    if (pressing || hovering) moveHost(event);
  }

  /** A pointer lifts, or the browser takes it away and its capture is lost. */
  function onPointerEnd(event: PointerEvent) {
    const lifted = event.type === "pointerup";
    if (gesture?.kind === "zoom") {
      if (gesture.points.delete(event.pointerId)) anchorZoom(gesture.points);
    } else if (gesture?.kind === "pending" && event.pointerId === gesture.down.pointerId) {
      clearTimeout(gesture.hold);
      gesture = undefined;
      // A tap presses and releases where it lifted. A touch that was taken does nothing.
      if (lifted && press(event, 0)) release(event);
    } else if (gesture?.kind === "press" && event.pointerId === gesture.pointerId) {
      release(lifted ? event : undefined);
    }
  }

  function onWheel(event: WheelEvent) {
    // Chrome and Firefox report a trackpad pinch as a wheel with the control key.
    if (event.ctrlKey) {
      event.preventDefault();
      const center = centered(event);
      zoomCanvas(zoom.current, { factor: Math.exp(-event.deltaY / 100), from: center, to: center });
    } else if (hasControl) {
      event.preventDefault();
      scrollHost(event);
    } else if (zoom.current.scale > 1) {
      event.preventDefault();
      const center = centered(event);
      const panned = { x: center.x - event.deltaX, y: center.y - event.deltaY };
      zoomCanvas(zoom.current, { factor: 1, from: center, to: panned });
    }
  }

  // Safari reports a trackpad pinch only as gesture events, with a cumulative scale. iOS
  // reports touch pinches that way too, but pointer events already handle those.
  function onGestureStart(event: GestureEvent) {
    event.preventDefault();
    trackpadPinch = gesture ? undefined : { start: zoom.current, center: centered(event) };
  }
  function onGestureChange(event: GestureEvent) {
    event.preventDefault();
    if (!trackpadPinch) return;
    const { start, center } = trackpadPinch;
    zoomCanvas(start, { factor: event.scale, from: center, to: center });
  }

  function onContextMenu(event: MouseEvent) {
    if (hasControl) event.preventDefault(); // The host shows its own menus.
  }

  // The local zoom

  /** A pointer joins the zoom, or starts one. */
  function joinZoom(event: PointerEvent, points = new Map<number, Point>()) {
    points.set(event.pointerId, centered(event));
    anchorZoom(points);
  }
  /** Pointers joined or left, so the zoom continues from where they and the canvas are now. */
  function anchorZoom(points: Map<number, Point>) {
    const pinch = measurePinch([...points.values()]);
    gesture = pinch && { kind: "zoom", points, start: zoom.current, pinch };
  }
  function zoomCanvas(start: Zoom, step: ZoomStep) {
    const next = zoomBy(start, step, pane.getBoundingClientRect(), canvas);
    zoom.current = next;
    canvas.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
  }
  /** A client point relative to the pane's center, the origin of the canvas's zoom. */
  function centered({ clientX, clientY }: { clientX: number; clientY: number }): Point {
    const bounds = pane.getBoundingClientRect();
    return {
      x: clientX - bounds.left - bounds.width / 2,
      y: clientY - bounds.top - bounds.height / 2,
    };
  }

  // A pending touch

  function pend(down: PointerEvent) {
    const hold = setTimeout(() => commit(down), HOLD_MS);
    gesture = { kind: "pending", down, latest: down, hold };
  }
  /** The pending touch meant to press the host, where it began. */
  function commit(down: PointerEvent) {
    if (gesture?.kind !== "pending") return;
    clearTimeout(gesture.hold);
    gesture = undefined;
    press(down, 0);
  }

  // The host

  /** Presses a host button under the pointer, unless it's off the frame. */
  function press(event: PointerEvent, button: number): boolean {
    const position = positionOf(event);
    if (!position) return false;
    gesture = { kind: "press", pointerId: event.pointerId, button };
    hostPosition = position;
    send({ type: "pointer", ...position, phase: "down", button });
    return true;
  }
  function moveHost(event: PointerEvent) {
    const position = positionOf(event);
    if (!position) return;
    hostPosition = position;
    send({ type: "pointer", ...position, phase: "move" });
  }
  /** Releases the pressed button where the pointer lifted, or else where it last was. */
  function release(event?: PointerEvent) {
    if (gesture?.kind !== "press") return;
    const { button } = gesture;
    gesture = undefined;
    hostPosition = (event && positionOf(event)) ?? hostPosition;
    send({ type: "pointer", ...hostPosition, phase: "up", button });
  }
  function scrollHost(event: WheelEvent) {
    const position = positionOf(event);
    if (!position) return;
    // Wheels report pixels, lines or pages; the host scrolls in pixels.
    const pixels =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? canvas.getBoundingClientRect().height
          : 1;
    send({ type: "scroll", ...position, dx: event.deltaX * pixels, dy: event.deltaY * pixels });
  }
  function positionOf({ clientX, clientY }: { clientX: number; clientY: number }) {
    return framePosition(canvas.getBoundingClientRect(), canvas, clientX, clientY);
  }

  const listening = new AbortController();
  const options = { signal: listening.signal, passive: false };
  pane.addEventListener("pointerdown", onPointerDown, options);
  pane.addEventListener("pointermove", onPointerMove, options);
  pane.addEventListener("pointerup", onPointerEnd, options);
  pane.addEventListener("lostpointercapture", onPointerEnd, options);
  pane.addEventListener("wheel", onWheel, options);
  pane.addEventListener("gesturestart", onGestureStart as EventListener, options);
  pane.addEventListener("gesturechange", onGestureChange as EventListener, options);
  pane.addEventListener("contextmenu", onContextMenu, options);
  return () => {
    listening.abort();
    if (gesture?.kind === "pending") clearTimeout(gesture.hold);
  };
}

/**
 * Where a client point lands on the frame, as fractions of it, or undefined off the frame.
 * The canvas's bounds include its zoom, and the frame is letterboxed within them.
 */
export function framePosition(
  bounds: { left: number; top: number; width: number; height: number },
  frame: Size,
  clientX: number,
  clientY: number,
): Point | undefined {
  if (!bounds.width || !bounds.height || !frame.width || !frame.height) return undefined;
  const scale = Math.min(bounds.width / frame.width, bounds.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const x = (clientX - bounds.left - (bounds.width - width) / 2) / width;
  const y = (clientY - bounds.top - (bounds.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}

/** Measures one pointer, which pans, or the first two, which pinch. */
export function measurePinch(points: readonly Point[]): Pinch | undefined {
  const [first, second = first] = points;
  if (!first || !second) return undefined;
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

/**
 * Takes a step from the `start` zoom. The scale stays between fitted and the largest frame's
 * own pixels, and panning stops at the frame's edges.
 */
export function zoomBy(start: Zoom, { factor, from, to }: ZoomStep, pane: Size, frame: Size): Zoom {
  const fit = Math.min(pane.width / frame.width, pane.height / frame.height);
  const most = Math.min(MAX_FRAME_SIZE.width / frame.width, MAX_FRAME_SIZE.height / frame.height);
  const scale = Math.max(1, Math.min(start.scale * factor, most / fit));
  const ratio = scale / start.scale;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value)) || 0;
  return {
    scale,
    x: clamp(
      to.x - (from.x - start.x) * ratio,
      Math.max(0, (frame.width * fit * scale - pane.width) / 2),
    ),
    y: clamp(
      to.y - (from.y - start.y) * ratio,
      Math.max(0, (frame.height * fit * scale - pane.height) / 2),
    ),
  };
}

import { getProcessValue } from "@/shared/server/processState";
import type { ScreenInput, ScreenList, ScreenStatus } from "../model";
import type { ScreenServerMessage } from "../model/protocol";
import {
  startScreenHelper,
  type CaptureEvent,
  type ScreenHelper,
  type StartScreenHelper,
} from "./helper";

/** Frames a viewer can have unacknowledged. A slower viewer skips ahead to the newest. */
const MAX_FRAMES_IN_FLIGHT = 3;

/** A viewer's socket. */
export type ScreenPeer = {
  id: string;
  send(data: string | Uint8Array): void;
  close(): void;
};

type Viewer = { peer: ScreenPeer; inFlight: number[]; lastSent: number };

/** A frame's packet as the helper wrote it, forwarded to viewers unchanged. */
type Frame = { sequence: number; packet: Uint8Array };

/** One native capture, shared by everyone viewing its screen. */
type Capture = {
  screenId: string;
  /** Known once the capture opens. */
  title?: string;
  status: ScreenStatus;
  /** Why the screen is paused or ended. */
  reason?: string;
  opened: Promise<void>;
  viewers: Map<string, Viewer>;
  /** The newest full frame, which every later region applies to. */
  full?: Frame;
  /** The newest frame, full or region. */
  latest?: Frame;
};

/**
 * The server's live screens. A screen is captured while anyone views it, each viewer
 * receives frames at its own pace, and one viewer at a time controls the host.
 */
export class ScreenRuntime {
  #captures = new Map<string, Capture>();
  #controller?: { screenId: string; viewerId: string };
  #helper?: Promise<ScreenHelper>;

  constructor(private startHelper: StartScreenHelper = startScreenHelper) {}

  async list(): Promise<ScreenList> {
    return (await this.#native()).list();
  }

  /** A thumbnail of a screen as it is now, whether or not anyone views it. */
  async thumbnail(screenId: string): Promise<string> {
    return (await this.#native()).thumbnail(screenId);
  }

  /** Sends a screen to a viewer until it detaches. Its first viewer opens the capture. */
  attach(screenId: string, peer: ScreenPeer): void {
    const capture = this.#captures.get(screenId) ?? this.#open(screenId);
    const viewer: Viewer = { peer, inFlight: [], lastSent: 0 };
    capture.viewers.set(peer.id, viewer);
    capture.opened.then(
      () => {
        if (capture.viewers.get(peer.id) !== viewer) return;
        this.#sendState(capture, viewer);
        this.#sendFrames(capture, viewer);
      },
      () => {}, // A capture that fails to open ends, along with its viewers.
    );
  }

  /** The last viewer to leave closes the capture. */
  detach(screenId: string, viewerId: string): void {
    const capture = this.#captures.get(screenId);
    if (!capture?.viewers.delete(viewerId)) return;
    this.releaseControl(screenId, viewerId).catch(logError);
    if (!capture.viewers.size) this.#end(capture, "Screen capture released.");
  }

  /** A viewer drew a frame, so it can receive newer ones. */
  acknowledge(screenId: string, viewerId: string, sequence: number): void {
    const capture = this.#captures.get(screenId);
    const viewer = capture?.viewers.get(viewerId);
    const drawn = viewer?.inFlight.indexOf(sequence) ?? -1;
    if (!capture || !viewer || drawn < 0) return;
    viewer.inFlight.splice(0, drawn + 1);
    this.#sendFrames(capture, viewer);
  }

  /** Gives a viewer control of the host, releasing anything the previous controller held. */
  async takeControl(screenId: string, viewerId: string): Promise<void> {
    if (!this.#captures.has(screenId))
      throw new Error("Screen is unavailable. Its display or window may have closed.");
    const controller = { screenId, viewerId };
    this.#controller = controller;
    this.#publishControl();
    try {
      const helper = await this.#native();
      if (this.#controller !== controller) return;
      // Sent together, the helper releases held input before it raises the window.
      await Promise.all([helper.releaseInput(), helper.focus(screenId)]);
    } catch (error) {
      if (this.#controller === controller) {
        this.#controller = undefined;
        this.#publishControl();
      }
      throw error;
    }
  }

  async input(screenId: string, viewerId: string, actions: ScreenInput[]): Promise<void> {
    const controller = this.#controller;
    const helper = await this.#native();
    // Control can change hands while this waits; input only counts for its sender.
    if (
      this.#controller !== controller ||
      controller?.screenId !== screenId ||
      controller.viewerId !== viewerId
    )
      throw new Error("Take control before sending screen input.");
    await helper.input(screenId, actions);
  }

  async releaseControl(screenId: string, viewerId: string): Promise<void> {
    if (this.#controller?.screenId !== screenId || this.#controller.viewerId !== viewerId) return;
    this.#controller = undefined;
    this.#publishControl();
    await (await this.#helper)?.releaseInput();
  }

  /**
   * Lets go of the helper as the server shuts down or restarts, so the process can exit.
   * Viewers close without their screens ending, so they reconnect, and the next one starts
   * a new helper.
   */
  async dispose(): Promise<void> {
    const helper = this.#helper;
    this.#helper = undefined;
    this.#controller = undefined;
    for (const { viewers } of this.#captures.values()) {
      for (const { peer } of viewers.values()) peer.close();
      viewers.clear();
    }
    this.#captures.clear();
    await helper?.then(
      (native) => native.close(),
      () => {},
    );
  }

  #open(screenId: string): Capture {
    const capture: Capture = {
      screenId,
      status: "live",
      viewers: new Map(),
      opened: this.#native()
        .then((helper) => helper.start(screenId))
        .then((title) => {
          capture.title = title;
        }),
    };
    this.#captures.set(screenId, capture);
    capture.opened.catch((error: Error) => this.#end(capture, error.message));
    return capture;
  }

  /** Ends a capture: its viewers learn why and close, and the helper stops it. */
  #end(capture: Capture, reason: string): void {
    const { screenId } = capture;
    if (this.#captures.get(screenId) !== capture) return;
    this.#captures.delete(screenId);
    capture.status = "ended";
    capture.reason = reason;
    if (this.#controller?.screenId === screenId)
      this.releaseControl(screenId, this.#controller.viewerId).catch(logError);
    for (const viewer of capture.viewers.values()) {
      this.#sendState(capture, viewer);
      viewer.peer.close();
    }
    // Queued now, the stop follows this capture's start and precedes any reopening's.
    this.#helper?.then((helper) => helper.stop(screenId)).catch(logError);
  }

  #native(): Promise<ScreenHelper> {
    return (this.#helper ??= this.startHelper(
      (event, packet) => this.#receive(event, packet),
      (error) => {
        console.error("Screen helper failed:", error);
        this.#helper = undefined;
        for (const capture of this.#captures.values()) this.#end(capture, error.message);
      },
    ).catch((error) => {
      this.#helper = undefined;
      throw error;
    }));
  }

  #receive(event: CaptureEvent, packet: Uint8Array): void {
    const capture = this.#captures.get(event.screenId);
    if (!capture) return;
    if (event.type === "frame") {
      capture.latest = { sequence: event.sequence, packet };
      if (!event.region) capture.full = capture.latest;
      for (const viewer of capture.viewers.values()) this.#sendFrames(capture, viewer);
    } else if (event.status === "ended") {
      this.#end(capture, event.reason ?? "Screen ended.");
    } else {
      capture.status = event.status;
      capture.reason = event.reason;
      // A paused screen can't take input, so its controller lets go.
      if (event.status === "paused" && this.#controller?.screenId === capture.screenId)
        this.releaseControl(capture.screenId, this.#controller.viewerId).catch(logError);
      for (const viewer of capture.viewers.values()) this.#sendState(capture, viewer);
    }
  }

  /** Sends what a viewer hasn't seen: the full frame its regions need, then the newest frame. */
  #sendFrames(capture: Capture, viewer: Viewer): void {
    for (const frame of [capture.full, capture.latest]) {
      if (!frame || frame.sequence <= viewer.lastSent) continue;
      if (viewer.inFlight.length >= MAX_FRAMES_IN_FLIGHT) return;
      viewer.inFlight.push(frame.sequence);
      viewer.lastSent = frame.sequence;
      viewer.peer.send(frame.packet);
    }
  }

  #sendState(capture: Capture, viewer: Viewer): void {
    const { screenId, title, status, reason } = capture;
    const message: ScreenServerMessage = {
      type: "state",
      title,
      status,
      reason,
      hasControl:
        this.#controller?.screenId === screenId && this.#controller.viewerId === viewer.peer.id,
    };
    viewer.peer.send(JSON.stringify(message));
  }

  #publishControl(): void {
    for (const capture of this.#captures.values())
      for (const viewer of capture.viewers.values()) this.#sendState(capture, viewer);
  }
}

function logError(error: unknown) {
  console.error("Screens:", error);
}

export const screenRuntime = getProcessValue("screen-runtime", () => new ScreenRuntime());

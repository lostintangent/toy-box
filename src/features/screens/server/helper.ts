import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ScreenFrame, ScreenInput, ScreenList, ScreenStatus } from "../model";
import { ScreenPacketReader } from "../model/protocol";
import {
  buildScreenNative,
  SCREEN_HELPER_EXECUTABLE,
  SCREEN_NATIVE_DIRECTORY,
} from "../native/build";

/** Captures run at 30 fps as JPEG, no larger than 3840x2400 or the display's backing scale. */
export const SCREEN_CAPTURE = { width: 3840, height: 2400, fps: 30, quality: 0.7 } as const;

/** Thumbnails are JPEG images, no larger than 960 pixels on either side. */
const SCREEN_THUMBNAIL = { size: 960, quality: 0.7 } as const;

/** What the helper reports about one open capture, tagged with its screen. */
export type CaptureEvent =
  | { type: "state"; screenId: string; status: ScreenStatus; reason?: string }
  | ({ type: "frame"; screenId: string } & ScreenFrame);

type Reply =
  | { type: "reply"; requestId: number; ok: true; value: unknown }
  | { type: "reply"; requestId: number; ok: false; error: string };

/** The native helper, which owns capture and host input. */
export type ScreenHelper = {
  list(): Promise<ScreenList>;
  /** A thumbnail of a screen as it is now, as a base64 JPEG. */
  thumbnail(screenId: string): Promise<string>;
  /** Starts capturing a screen, and resolves its title. */
  start(screenId: string): Promise<string>;
  /** Stops a screen's capture, if it has one. */
  stop(screenId: string): Promise<void>;
  /** Raises a window and its app to receive input. A display needs nothing. */
  focus(screenId: string): Promise<void>;
  input(screenId: string, actions: ScreenInput[]): Promise<void>;
  /** Lets go of every key and button held down on the host. */
  releaseInput(): Promise<void>;
  /** Lets it answer what it was sent, then release held input and exit. */
  close(): Promise<void>;
};

/** Each event comes with the packet that carried it, so frames can be forwarded as is. */
export type StartScreenHelper = (
  onEvent: (event: CaptureEvent, packet: Uint8Array) => void,
  onFailure: (error: Error) => void,
  /** An isolated instrumented executable and environment for native benchmarks. */
  options?: { executable: string; env: Record<string, string | undefined> },
) => Promise<ScreenHelper>;

const REQUEST_TIMEOUT_MS = 60_000;
/** How long a closed helper gets to exit before it's killed. */
const CLOSE_TIMEOUT_MS = 2000;

/**
 * Starts the helper: requests go to its stdin as JSON lines, and replies and capture
 * events come back on stdout as packets. Its open pipes keep the server alive, so the
 * server closes it on shutdown; it can't outlive the server either way. A crash, timeout
 * or unreadable packet fails every pending request, and `onFailure` hears about it once.
 */
export const startScreenHelper: StartScreenHelper = async (onEvent, onFailure, options) => {
  const helper = Bun.spawn([options?.executable ?? (await helperExecutable())], {
    env: options?.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let lastRequestId = 0;
  /** Why the helper takes no more requests, once it has failed or closed. */
  let failure: Error | undefined;

  /** Rejects the requests still waiting for a reply. */
  function rejectPending(error: Error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  function fail(error: Error) {
    if (failure) return;
    failure = error;
    rejectPending(error);
    helper.kill();
    onFailure(error);
  }

  function settle(reply: Reply) {
    const request = pending.get(reply.requestId);
    if (!request) return;
    pending.delete(reply.requestId);
    clearTimeout(request.timer);
    if (reply.ok) request.resolve(reply.value);
    else request.reject(new Error(reply.error));
  }

  /**
   * Sends a request and resolves its reply. Requests are written in the order they're made,
   * which is the order the helper runs its commands in.
   */
  async function request<Result = void>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    if (failure) throw failure;
    const id = ++lastRequestId;
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => fail(new Error(`Screen helper timed out handling ${method}.`)),
        REQUEST_TIMEOUT_MS,
      );
      pending.set(id, { resolve, reject, timer });
    });
    try {
      await helper.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      await helper.stdin.flush();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
    return (await reply) as Result;
  }

  void helper.exited.then((code) => fail(new Error(`Screen helper exited (${code}).`)));
  void (async () => {
    const reader = new ScreenPacketReader();
    for await (const chunk of helper.stdout) {
      for (const { metadata, bytes } of reader.push(chunk)) {
        const message = metadata as CaptureEvent | Reply;
        if (message.type === "reply") settle(message);
        else onEvent(message, bytes);
      }
    }
    reader.end();
  })().catch((error: Error) => fail(error));

  return {
    list: () => request<ScreenList>("list"),
    thumbnail: (screenId) => request<string>("thumbnail", { screenId, ...SCREEN_THUMBNAIL }),
    start: (screenId) => request<string>("start", { screenId, capture: SCREEN_CAPTURE }),
    stop: (screenId) => request("stop", { screenId }),
    focus: (screenId) => request("focus", { screenId }),
    input: (screenId, actions) => request("input", { screenId, actions }),
    releaseInput: () => request("releaseInput"),
    async close() {
      if (failure) return;
      failure = new Error("Screen helper closed.");
      const kill = setTimeout(() => helper.kill(), CLOSE_TIMEOUT_MS);
      await helper.stdin.end();
      await helper.exited;
      clearTimeout(kill);
      rejectPending(failure); // Only if it was killed before answering.
    },
  };
};

/** Development builds the helper whenever its source changes; the binary extracts its own copy once per version. */
async function helperExecutable(): Promise<string> {
  if (!Bun.isStandaloneExecutable) return buildScreenNative();
  const bytes = await Bun.file(
    join(import.meta.dir, SCREEN_NATIVE_DIRECTORY, SCREEN_HELPER_EXECUTABLE),
  ).bytes();
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const executable = join(
    homedir(),
    ".toy-box",
    "native",
    "screen",
    `${SCREEN_HELPER_EXECUTABLE}-${hash}`,
  );
  if (!(await Bun.file(executable).exists())) {
    await mkdir(dirname(executable), { recursive: true });
    await Bun.write(executable, bytes);
    await chmod(executable, 0o755);
  }
  return executable;
}

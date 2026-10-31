import { z } from "zod";
import { createPane } from "@workspace/model/panes";

/** A display or window the host can share. */
export type Screen = { id: string; title: string };

declare module "@workspace/model/panes" {
  interface WorkspacePanes {
    /** A live view of one screen, which a session may have published as its preview. */
    screen: { screenId: string };
  }
}

export const createScreenPane = (screenId: string, sessionId?: string) =>
  createPane("screen", screenId, { screenId, sessionId });

/** Everything the host can share: every display, and its on-screen windows. */
export type ScreenList = {
  displays: Screen[];
  windows: (Screen & { application: string })[];
};

/** Matches windows by title or application; displays are few, so they always show. */
export function filterScreenWindows(windows: ScreenList["windows"], query = "") {
  const term = query.trim().toLowerCase();
  return term
    ? windows.filter((window) =>
        `${window.title} ${window.application}`.toLowerCase().includes(term),
      )
    : windows;
}

/**
 * Whether a viewed screen is being captured, suspended by the host, or gone for good. A
 * paused or ended screen comes with the reason.
 */
export type ScreenStatus = "live" | "paused" | "ended";

/**
 * One image update. A full frame replaces the image; a region frame carries only what
 * changed since the latest full frame, positioned within it. Width, height and radius are
 * always the full frame's.
 */
export type ScreenFrame = {
  sequence: number;
  width: number;
  height: number;
  /**
   * A window's rounded corners, in pixels. They're see-through, which JPEG can't carry, so
   * viewers clip to them. Displays have none.
   */
  radius?: number;
  region?: { x: number; y: number; width: number; height: number };
};

/** Input a controlling viewer sends to the host, positioned as fractions of the frame. */
const position = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) };
export const screenInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("pointer"),
      ...position,
      phase: z.enum(["move", "down", "up"]),
      button: z.number().int().min(0).max(2).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      ...position,
      dx: z.number().finite().min(-10000).max(10000),
      dy: z.number().finite().min(-10000).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      code: z.string().min(1).max(32),
      down: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      text: z.string().min(1).max(4096),
    })
    .strict(),
]);
export type ScreenInput = z.infer<typeof screenInputSchema>;

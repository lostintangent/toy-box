import { z } from "zod";

export const SMALL_JSON_MAX_BYTES = 64 * 1024;

const encoder = new TextEncoder();

/** JSON small enough to travel in workspace snapshots and agent control-plane calls. */
export const smallJsonSchema = z
  .json()
  .refine(
    (value) => encoder.encode(JSON.stringify(value)).byteLength <= SMALL_JSON_MAX_BYTES,
    `JSON must be at most ${SMALL_JSON_MAX_BYTES} bytes.`,
  );

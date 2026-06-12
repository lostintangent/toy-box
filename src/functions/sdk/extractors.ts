// Defensive field accessors for SDK event payloads.
//
// These exist because events arrive from outside the type system (parsed
// events.jsonl lines, RPC payloads), so reads stay runtime-tolerant at this
// boundary. Keep this surface minimal — every stringly-keyed read here is
// invisible to the compiler, so schema drift (renamed/moved SDK fields) only
// surfaces through tests, not types.

import type { JsonValue } from "@/types";
import type { SessionEvent as CopilotSdkSessionEvent } from "@github/copilot-sdk";

type UnknownRecord = Record<string, unknown>;

type UnknownSdkSessionEvent = {
  type: CopilotSdkSessionEvent["type"] | (string & {});
  timestamp?: string;
  data?: unknown;
};

export type SdkSessionEvent = CopilotSdkSessionEvent | UnknownSdkSessionEvent;

export function readArguments(value: UnknownRecord | undefined): { [key: string]: JsonValue } {
  if (!value) return {};
  return value as { [key: string]: JsonValue };
}

export function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as UnknownRecord;
}

export function readPath(value: unknown, ...path: string[]): unknown {
  let current = value;

  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as UnknownRecord)[segment];
  }

  return current;
}

export function readArray(value: unknown, key: string): unknown[] | undefined {
  const maybeArray = readPath(value, key);
  return Array.isArray(maybeArray) ? maybeArray : undefined;
}

export function readString(value: unknown, key: string): string | undefined {
  const maybeString = readPath(value, key);
  return typeof maybeString === "string" ? maybeString : undefined;
}

export function readBoolean(value: unknown, key: string): boolean {
  return Boolean(readPath(value, key));
}

export function readStringPath(value: unknown, ...path: string[]): string | undefined {
  const maybeString = readPath(value, ...path);
  return typeof maybeString === "string" ? maybeString : undefined;
}

// Defensive field accessors for untyped SDK event data.
//
// SDK events carry `data?: Record<string, unknown>`, so every property
// access needs runtime narrowing. These helpers centralise that logic
// so the projector can stay declarative.

import type { JsonValue } from "@/types";
import type { SessionEvent as CopilotSdkSessionEvent } from "@github/copilot-sdk";

export type UnknownRecord = Record<string, unknown>;

export type SdkSessionEvent = {
  type: CopilotSdkSessionEvent["type"] | (string & {});
  timestamp?: string;
  data?: UnknownRecord;
};

export function readArguments(value: UnknownRecord | undefined): { [key: string]: JsonValue } {
  if (!value) return {};
  return value as { [key: string]: JsonValue };
}

export function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as UnknownRecord;
}

export function readRecord(value: unknown, key: string): UnknownRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  return asRecord((value as UnknownRecord)[key]);
}

export function readArray(value: unknown, key: string): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybeArray = (value as UnknownRecord)[key];
  return Array.isArray(maybeArray) ? maybeArray : undefined;
}

export function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybeString = (value as UnknownRecord)[key];
  return typeof maybeString === "string" ? maybeString : undefined;
}

export function readBoolean(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  return Boolean((value as UnknownRecord)[key]);
}

export function readSessionTitleFromTitleChanged(
  event: Pick<SdkSessionEvent, "type" | "data">,
): string | undefined {
  if (event.type !== "session.title_changed") return undefined;
  return readString(event.data, "title");
}

export function readSessionModel(
  event: Pick<SdkSessionEvent, "type" | "data">,
): string | undefined {
  if (event.type === "session.start") {
    return readString(event.data, "selectedModel");
  }
  if (event.type === "session.model_change") {
    return readString(event.data, "newModel");
  }
  return undefined;
}

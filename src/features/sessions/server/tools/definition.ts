import type { z } from "zod";

export type Tool<T = unknown> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  /** Receives the calling session's public ID, regardless of the native backend. */
  handler: (args: T, sessionId: string) => unknown;
  /** A successful result completes the current turn. */
  isTerminal?: boolean;
  /** Always in the model's context, never deferred behind tool search. */
  alwaysLoad?: boolean;
};

export function defineTool<T = unknown>(name: string, definition: Omit<Tool<T>, "name">): Tool<T> {
  return { name, ...definition };
}

/** The model receives a handler's string as is, and any other value as JSON. */
export function toolResultText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

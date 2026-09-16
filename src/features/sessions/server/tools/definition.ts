import type { z } from "zod";

/** Every handler sees Toy Box session identity, regardless of the native backend. */
export type ToolInvocation = {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  signal?: AbortSignal;
};

export type Tool<T = unknown> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  handler: (args: T, invocation: ToolInvocation) => unknown;
  /** A successful result completes the current turn. */
  isTerminal?: boolean;
};

export function defineTool<T = unknown>(name: string, definition: Omit<Tool<T>, "name">): Tool<T> {
  return { name, ...definition };
}

export type ToolResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
};

export function normalizeToolResult(value: unknown): ToolResult {
  if (
    value &&
    typeof value === "object" &&
    "content" in value &&
    Array.isArray(value.content) &&
    value.content.every(
      (block: unknown) =>
        block &&
        typeof block === "object" &&
        "type" in block &&
        (block.type === "text"
          ? "text" in block && typeof block.text === "string"
          : block.type === "image" &&
            "data" in block &&
            typeof block.data === "string" &&
            "mimeType" in block &&
            typeof block.mimeType === "string"),
    )
  ) {
    return value as ToolResult;
  }
  return {
    content: [
      { type: "text", text: typeof value === "string" ? value : (JSON.stringify(value) ?? "") },
    ],
  };
}

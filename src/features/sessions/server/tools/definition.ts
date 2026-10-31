import { z } from "zod";

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

const toolResultSchema = z.object({
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }),
    ]),
  ),
  isError: z.boolean().optional(),
});

export type ToolResult = z.infer<typeof toolResultSchema>;

/** Handlers return a ToolResult, a string, or any JSON value, which becomes one text block. */
export function normalizeToolResult(value: unknown): ToolResult {
  const result = toolResultSchema.safeParse(value);
  if (result.success) return result.data;
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return { content: [{ type: "text", text }] };
}

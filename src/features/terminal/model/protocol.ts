import { z } from "zod";

const positiveIntSchema = z.number().int().positive();

export const terminalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("init"),
    clientId: z.string().min(1),
    cols: positiveIntSchema.optional(),
    rows: positiveIntSchema.optional(),
    shell: z.string().optional(),
  }),
  z.object({
    type: z.literal("resize"),
    cols: positiveIntSchema,
    rows: positiveIntSchema,
  }),
  z.object({ type: z.literal("close") }),
]);

export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export type TerminalServerMessage = { type: "ready"; resumed: boolean } | { type: "exit" };

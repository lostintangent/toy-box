import { z } from "zod";

const positiveIntSchema = z.number().int().positive();

/** The tab a socket shows the PTY of, and its size, named in the socket's URL. */
export const terminalAttachSchema = z.object({
  clientId: z.string().min(1),
  cols: z.coerce.number().int().positive().optional(),
  rows: z.coerce.number().int().positive().optional(),
});

export const terminalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resize"),
    cols: positiveIntSchema,
    rows: positiveIntSchema,
  }),
  z.object({ type: z.literal("close") }),
]);

export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export type TerminalServerMessage = { type: "ready"; resumed: boolean } | { type: "exit" };

import { z } from "zod";

/** Client-issued workspace transitions, validated by the workspace RPC. */
export const workspaceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.prompt.drafted"),
    sessionId: z.string(),
    prompt: z.object({
      text: z.string().max(64 * 1024),
      updatedAt: z.number(),
      origin: z.string().min(1).max(128),
    }),
  }),
  sessionAction("hyper.promoted"),
  sessionAction("read"),
]);

export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;

function sessionAction<Name extends string>(name: Name) {
  return z.object({ type: z.literal(`session.${name}`), sessionId: z.string() });
}

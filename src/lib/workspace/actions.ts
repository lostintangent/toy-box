import { z } from "zod";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";

/** Client-issued workspace transitions, validated by the workspace RPC. */
export const workspaceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.draft.created"),
    sessionId: z.string().startsWith(SESSION_ID_PREFIX),
    // Enables atomic draft + hyper membership creation.
    hyper: z.literal(true).optional(),
    // Lets the optimistic draft sort correctly before the server-stamped echo.
    createdAt: z.number(),
  }),
  z.object({
    type: z.literal("session.prompt.drafted"),
    sessionId: z.string(),
    prompt: z.object({
      text: z.string().max(64 * 1024),
      updatedAt: z.number(),
      origin: z.string().min(1).max(128),
    }),
  }),
  sessionAction("draft.discarded"),
  sessionAction("hyper.promoted"),
  sessionAction("read"),
]);

export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;

function sessionAction<Name extends string>(name: Name) {
  return z.object({ type: z.literal(`session.${name}`), sessionId: z.string() });
}

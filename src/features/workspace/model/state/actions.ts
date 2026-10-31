import { z } from "zod";
import { draftKeySchema, savedDraftSchema } from "./drafts";

/** Client-issued workspace transitions, validated by the workspace RPC. */
export const workspaceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("draft.changed"),
    key: draftKeySchema,
    draft: savedDraftSchema,
  }),
  z.object({ type: z.literal("session.hyper.promoted"), sessionId: z.string() }),
]);

export type WorkspaceAction = z.infer<typeof workspaceActionSchema>;

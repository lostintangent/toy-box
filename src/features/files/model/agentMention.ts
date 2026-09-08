import { z } from "zod";
import { agentMentionSchema, fileAgentHostSchema } from "@agents/model";

/** The renderer persists the comment, then addresses an Agent with the complete thread prompt. */
export const mentionFileAgentInputSchema = agentMentionSchema
  .extend({
    host: fileAgentHostSchema,
    prompt: z.string().trim().min(1).max(50_000),
  })
  .strict();

export type MentionFileAgentInput = z.output<typeof mentionFileAgentInputSchema>;

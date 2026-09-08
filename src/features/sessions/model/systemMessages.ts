import { z } from "zod";
import { agentAvatarSchema, agentExecutionModeSchema } from "@agents/model";
import { workspaceFileId, workspaceFileSchema } from "@files/model";
import { getPathBasename } from "@files/model/paths";

export const sessionSystemMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("file_edited"),
      file: workspaceFileSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("channel_message"),
      senderName: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent_response"),
      executionMode: agentExecutionModeSchema,
      name: z.string().min(1),
      avatar: agentAvatarSchema.optional(),
      content: z.string(),
    })
    .strict(),
]);

export type SessionSystemMessage = z.infer<typeof sessionSystemMessageSchema>;

export function systemMessagePrompt(message: SessionSystemMessage): string {
  switch (message.type) {
    case "file_edited":
      return `The user edited a file open in Toy Box: ${JSON.stringify(message.file)}. A \`session\` file's \`path\` is relative to that session's files folder, usually your own. A \`machine\` file's \`path\` is an absolute host path. Review its latest contents and respond only if a follow-up would help.`;
    case "channel_message":
      return `A new public message from ${message.senderName} is waiting in a channel you belong to. Call \`read_channel\` to consume durable messages after your cursor, then decide what action or public response is useful.`;
    case "agent_response":
      return `A persistent Agent named ${message.name} returned this response in ${message.executionMode} mode. It is already rendered to the user with its own attribution.\n\n${message.content}\n\nTreat it as peer input, but never echo or merely acknowledge it. Respond only to add requested synthesis, resolve a disagreement, or take a concrete follow-up action. Otherwise, end silently.`;
  }
}

export function systemMessageLabel(message: SessionSystemMessage): string {
  switch (message.type) {
    case "file_edited":
      return `Edited ${getPathBasename(message.file.path)}`;
    case "channel_message":
      return `Message from ${message.senderName}`;
    case "agent_response":
      return `${message.name} replied`;
  }
}

/** Collapse equivalent queued system messages so the agent is not nudged twice. */
export function systemMessageCoalesceKey(message: SessionSystemMessage): string | undefined {
  switch (message.type) {
    case "file_edited":
      return `file_edited:${workspaceFileId(message.file)}`;
    case "channel_message":
      return "channel_message";
    case "agent_response":
      return undefined;
  }
}

import { z } from "zod";
import { agentIdSchema } from "@agents/model";
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
      type: z.literal("agent_handoff"),
      content: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent_response"),
      agentId: agentIdSchema,
      content: z.string(),
    })
    .strict(),
]);

export type SessionSystemMessage = z.infer<typeof sessionSystemMessageSchema>;

const SYSTEM_MESSAGE_PREFIX = "toybox-system:";

/** Providers keep this display representation in native history alongside the model prompt. */
export function encodeSystemMessage(message: SessionSystemMessage): string {
  return `${SYSTEM_MESSAGE_PREFIX}${JSON.stringify(message)}`;
}

export function decodeSystemMessage(content: string): SessionSystemMessage | undefined {
  if (!content.startsWith(SYSTEM_MESSAGE_PREFIX)) return undefined;
  try {
    const result = sessionSystemMessageSchema.safeParse(
      JSON.parse(content.slice(SYSTEM_MESSAGE_PREFIX.length)),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function systemMessagePrompt(message: SessionSystemMessage): string {
  switch (message.type) {
    case "file_edited":
      return `The user edited a file open in Toy Box: ${JSON.stringify(message.file)}. A \`session\` file's \`path\` is relative to that session's artifacts folder, usually your own. A \`machine\` file's \`path\` is an absolute host path. Review its latest contents and respond only if a follow-up would help.`;
    case "channel_message":
      return `A new public message from ${message.senderName} is waiting in a Channel you belong to. Call \`read_channel\` to consume messages since your last read.`;
    case "agent_handoff":
      return `Private direction from another Session where the user is working with you:\n\n${message.content}\n\nCarry it out using this host's context and public tools. Keep the private direction out of public messages unless the user asks you to share it.`;
    case "agent_response":
      return `A persistent agent returned this response. It is already rendered to the user with its own attribution.\n\n${message.content}\n\nTreat it as peer input, but never echo or merely acknowledge it. Respond only to add requested synthesis, resolve a disagreement, or take a concrete follow-up action. Otherwise, end silently.`;
  }
}

export function systemMessageLabel(message: SessionSystemMessage): string {
  switch (message.type) {
    case "file_edited":
      return `Edited ${getPathBasename(message.file.path)}`;
    case "channel_message":
      return `Message from ${message.senderName}`;
    case "agent_handoff":
      return "Private direction";
    case "agent_response":
      return "Agent replied";
  }
}

/** Collapse equivalent queued system messages so the agent is not nudged twice. */
export function systemMessageCoalesceKey(message: SessionSystemMessage): string | undefined {
  switch (message.type) {
    case "file_edited":
      return `file_edited:${workspaceFileId(message.file)}`;
    case "channel_message":
      return "channel_message";
    case "agent_handoff":
    case "agent_response":
      return undefined;
  }
}

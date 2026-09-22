import { z } from "zod";
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
  z.object({ type: z.literal("channel_started") }).strict(),
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
      return `A new public message from ${message.senderName} is waiting in a channel you belong to. Call \`read_channel\` to consume messages since your last read.`;
    case "channel_started":
      return "This channel was just created. Begin working toward its purpose.";
  }
}

export function systemMessageLabel(message: SessionSystemMessage): string {
  switch (message.type) {
    case "file_edited":
      return `Edited ${getPathBasename(message.file.path)}`;
    case "channel_message":
      return `Message from ${message.senderName}`;
    case "channel_started":
      return "Channel started";
  }
}

/** Collapse equivalent queued system messages so the agent is not nudged twice. */
export function systemMessageCoalesceKey(message: SessionSystemMessage): string | undefined {
  switch (message.type) {
    case "file_edited":
      return `file_edited:${workspaceFileId(message.file)}`;
    case "channel_message":
      return "channel_message";
    case "channel_started":
      return;
  }
}

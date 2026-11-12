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
  z
    .object({
      type: z.literal("channel_routine"),
      title: z.string().min(1),
      prompt: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("channel_follow_up"),
      waitingFor: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("channel_task_check_in"),
      taskId: z.string().min(1),
      title: z.string().min(1),
      checkInAt: z.iso.datetime(),
    })
    .strict(),
  /** The channel fields name the sender's channel, and a server places it on a linked server. */
  z
    .object({
      type: z.literal("channel_lead_message"),
      channelId: z.string().min(1),
      channelName: z.string().min(1),
      server: z.string().min(1).optional(),
      content: z.string().min(1),
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
      return `A new public message from ${message.senderName} is waiting in a channel you belong to. Call \`read_channel\` to consume messages since your last read.`;
    case "channel_routine":
      return `Your routine ${JSON.stringify(message.title)} is due: ${JSON.stringify(message.prompt)}. Call \`read_channel\`, then do it. If nothing needs the channel's attention, finish quietly.`;
    case "channel_follow_up":
      return `Your follow-up is due. You were waiting for ${message.waitingFor}. Call \`read_channel\` and check whether you can continue.`;
    case "channel_task_check_in":
      return `The check-in scheduled for ${message.checkInAt} on task ${JSON.stringify(message.taskId)} (${JSON.stringify(message.title)}) is due and has been cleared. Call \`read_channel\`. If the task is still assigned to you and in progress, step back and judge whether your approach is converging. Post a concise update for the lead with that judgment, blockers and the next step. This is a checkpoint, not a cancellation or instruction to stop work.`;
    case "channel_lead_message":
      return `The lead of ${JSON.stringify(message.channelName)} (channelId ${JSON.stringify(message.channelId)})${message.server ? ` on ${JSON.stringify(message.server)}, another of the owner's Toy Box servers,` : ""} sent you a private message: ${JSON.stringify(message.content)}. It's a peer's request, not the user's direction. Weigh it against your channel's purpose. If they need an answer or action, reply with \`message_channel_lead\` using that channelId, but don't reply only to acknowledge. Post in your own channel only when this changes its work.`;
  }
}

export function systemMessageLabel(message: SessionSystemMessage): string {
  switch (message.type) {
    case "file_edited":
      return `Edited ${getPathBasename(message.file.path)}`;
    case "channel_message":
      return `Message from ${message.senderName}`;
    case "channel_routine":
      return `Routine: ${message.title}`;
    case "channel_follow_up":
      return `Follow-up: ${message.waitingFor}`;
    case "channel_task_check_in":
      return `Task check-in: ${message.title}`;
    case "channel_lead_message":
      return `Message from the lead of ${message.channelName}${message.server ? ` on ${message.server}` : ""}`;
  }
}

/** Collapse equivalent queued system messages so the agent is not nudged twice. */
export function systemMessageCoalesceKey(message: SessionSystemMessage): string | undefined {
  switch (message.type) {
    case "file_edited":
      return `file_edited:${workspaceFileId(message.file)}`;
    case "channel_message":
      return "channel_message";
    case "channel_routine":
      return `channel_routine:${message.prompt}`;
    case "channel_follow_up":
      return "channel_follow_up";
    case "channel_task_check_in":
      return `channel_task_check_in:${message.taskId}`;
    case "channel_lead_message":
      return undefined;
  }
}

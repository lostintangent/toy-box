import {
  isChannelSystemMessage,
  type ChannelMessage,
  type ChannelConversationMessage,
  type ChannelEvent,
} from "@channels/model";
import { machineFile } from "@files/model";
import { createFileServeUrl, getPathBasename } from "@files/model/paths";
import type { StoredAttachment, StoredChannelMessage } from "./database";

/** Resolve client file addresses at the protocol boundary; stored paths stay server-side. */
export function resolveMessageResources(
  message: ChannelConversationMessage<StoredAttachment>,
): ChannelConversationMessage;
export function resolveMessageResources(message: StoredChannelMessage): ChannelMessage;
export function resolveMessageResources(message: StoredChannelMessage): ChannelMessage {
  if (isChannelSystemMessage(message)) {
    if (message.content.type !== "artifact_shared") return message;
    const artifact = {
      ...message.content.artifact,
      url: createFileServeUrl(message.content.artifact.file),
    };
    return {
      ...message,
      content: {
        ...message.content,
        artifact,
      },
    };
  }
  const { attachments, ...rest } = message;
  return {
    ...rest,
    ...(attachments
      ? {
          attachments: attachments.map((attachment) =>
            typeof attachment === "string"
              ? {
                  name: getPathBasename(attachment),
                  url: createFileServeUrl(machineFile(attachment)),
                }
              : attachment,
          ),
        }
      : {}),
  };
}

export function resolveEventResources(event: ChannelEvent<StoredAttachment>): ChannelEvent {
  return event.type === "message"
    ? { ...event, message: resolveMessageResources(event.message) }
    : event;
}

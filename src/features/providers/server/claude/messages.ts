import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Attachment, SessionEvent, SessionMessage } from "@sessions/model";
import {
  decodeSystemMessage,
  encodeSystemMessage,
  systemMessagePrompt,
} from "@sessions/model/systemMessages";

type Content = SDKUserMessage["message"]["content"];

/** Image inputs and structured notifications live in Claude's native transcript. */
export function encodeInput(message: SessionMessage): Content {
  if (message.role === "system")
    return [
      { type: "text", text: encodeSystemMessage(message.content) },
      { type: "text", text: systemMessagePrompt(message.content) },
    ];

  const content: Exclude<Content, string> = [];
  if (message.content) content.push({ type: "text", text: message.content });
  for (const { mimeType, base64: data } of message.attachments ?? []) {
    if (
      mimeType === "image/jpeg" ||
      mimeType === "image/png" ||
      mimeType === "image/gif" ||
      mimeType === "image/webp"
    ) {
      content.push({ type: "image", source: { type: "base64", media_type: mimeType, data } });
    } else {
      throw new Error("Claude Agent supports PNG, JPEG, GIF, and WebP images.");
    }
  }
  return content;
}

export function decodeInput(content: Content, clientId?: string, timestamp?: string): SessionEvent {
  const blocks = typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
  const first = blocks[0];
  const system = first?.type === "text" ? decodeSystemMessage(first.text) : undefined;
  if (system) return { type: "system_message", content: system, clientId, timestamp };

  const text: string[] = [];
  const attachments: Attachment[] = [];
  for (const block of blocks) {
    if (block.type === "text") text.push(block.text);
    if (block.type === "image" && block.source.type === "base64")
      attachments.push({ mimeType: block.source.media_type, base64: block.source.data });
  }
  return {
    type: "user_message",
    content: displayPrompt(text.join("\n")),
    clientId,
    timestamp,
    // Claude exposes file rewind and resume-at branching, not an in-place conversation rewind.
    rewindable: false,
    ...(attachments.length ? { attachments } : {}),
  };
}

/** Claude records a slash invocation as command markup, separately from its hidden skill prompt. */
function displayPrompt(text: string): string {
  const command =
    /^<command-message>[\s\S]*?<\/command-message>\n<command-name>([^<]+)<\/command-name>(?:\n<command-args>([\s\S]*)<\/command-args>)?$/.exec(
      text,
    );
  return command ? [command[1], command[2]].filter(Boolean).join(" ") : text;
}

import { join } from "node:path";
import type { Attachment, SessionEvent, SessionMessage, SessionSkill } from "@sessions/model";
import { attachmentSchema } from "@sessions/model/protocol";
import {
  decodeSystemMessage,
  encodeSystemMessage,
  systemMessagePrompt,
} from "@sessions/model/systemMessages";
import type { Thread, ThreadItem, UserInput } from "./protocol";

const ATTACHMENT_PREFIX = "toybox-attachment:";

/** Native text spans preserve display content without changing the model's prompt.
 * Images use native media inputs; other files retain their bytes in a display span
 * and expose a staged path to the model. No input is copied to Toy Box's database. */
export async function encodeInput(
  attachmentsDirectory: string,
  message: SessionMessage,
  skills: readonly SessionSkill[],
): Promise<UserInput[]> {
  if (message.role === "system")
    return [
      displayText(systemMessagePrompt(message.content), encodeSystemMessage(message.content)),
    ];

  const input: UserInput[] = [{ type: "text", text: message.content, text_elements: [] }];
  const skillName = message.content.match(/^\/([^\s]+)(?:\s|$)/)?.[1];
  const skill = skills.find((candidate) => candidate.name === skillName);
  if (skill?.path) input.push({ type: "skill", name: skill.name, path: skill.path });
  for (const [index, attachment] of (message.attachments ?? []).entries()) {
    if (attachment.mimeType.startsWith("image/")) {
      input.push({
        type: "image",
        url: `data:${attachment.mimeType};base64,${attachment.base64}`,
      });
    } else {
      // Client IDs must never become path traversal within the session's directory.
      const key = new Bun.CryptoHasher("sha256").update(message.clientId).digest("hex");
      const path = join(attachmentsDirectory, key, String(index));
      await Bun.write(path, Buffer.from(attachment.base64, "base64"));
      input.push(
        displayText(
          `Attached file (${attachment.mimeType}): ${path}`,
          `${ATTACHMENT_PREFIX}${JSON.stringify(attachment)}`,
        ),
      );
    }
  }
  return input;
}

export function decodeInput(
  item: Extract<ThreadItem, { type: "userMessage" }>,
  timestamp: string,
): SessionEvent {
  const identity = { timestamp, ...(item.clientId ? { clientId: item.clientId } : {}) };
  const display = item.content.length === 1 ? displayContent(item.content[0]!) : undefined;
  const system = display === undefined ? undefined : decodeSystemMessage(display);
  if (system) return { type: "system_message", content: system, ...identity };
  const text: string[] = [];
  const attachments: Attachment[] = [];
  for (const input of item.content) {
    const attachment = readAttachment(input);
    if (attachment) attachments.push(attachment);
    else if (input.type === "text") text.push(input.text);
  }
  return {
    type: "user_message",
    content: text.join("\n"),
    ...identity,
    ...(attachments?.length ? { attachments } : {}),
  };
}

function displayText(text: string, placeholder: string): UserInput {
  return {
    type: "text",
    text,
    text_elements: [{ byteRange: { start: 0, end: Buffer.byteLength(text) }, placeholder }],
  };
}

function displayContent(input: UserInput): string | undefined {
  if (input.type !== "text" || input.text_elements.length !== 1) return undefined;
  const element = input.text_elements[0]!;
  return element.byteRange.start === 0 && element.byteRange.end === Buffer.byteLength(input.text)
    ? (element.placeholder ?? undefined)
    : undefined;
}

/** Imported CLI conversations can reference local media instead of data URLs. */
export async function hydrateThreadInputs(thread: Thread): Promise<Thread> {
  return {
    ...thread,
    turns: await Promise.all(
      thread.turns.map(async (turn) => ({
        ...turn,
        items: await Promise.all(
          turn.items.map(async (item) =>
            item.type !== "userMessage"
              ? item
              : {
                  ...item,
                  content: await Promise.all(item.content.map(hydrateNativeInput)),
                },
          ),
        ),
      })),
    ),
  };
}

async function hydrateNativeInput(input: UserInput): Promise<UserInput> {
  if (input.type !== "localImage" && input.type !== "localAudio") return input;
  const type = input.type === "localImage" ? "image" : "audio";
  const file = Bun.file(input.path);
  try {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const mimeType = file.type || (type === "image" ? "image/png" : "audio/wav");
    return { type, url: `data:${mimeType};base64,${data}` };
  } catch {
    return {
      type: "text",
      text: `[Unavailable ${type} attachment: ${input.path}]`,
      text_elements: [],
    };
  }
}

function readAttachment(input: UserInput): Attachment | undefined {
  if (input.type === "image" || input.type === "audio") {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(input.url);
    return match ? { mimeType: match[1]!, base64: match[2]! } : undefined;
  }
  const display = displayContent(input);
  if (!display?.startsWith(ATTACHMENT_PREFIX)) return undefined;
  try {
    const result = attachmentSchema.safeParse(JSON.parse(display.slice(ATTACHMENT_PREFIX.length)));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

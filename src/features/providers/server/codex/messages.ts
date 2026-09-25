import type { SessionEvent, SessionMessage, SessionSkill } from "@sessions/model";
import type { Attachment } from "@/shared/attachments/model";
import {
  decodeSystemMessage,
  encodeSystemMessage,
  systemMessagePrompt,
} from "@sessions/model/systemMessages";
import type { Thread, ThreadItem, UserInput } from "./protocol";

/** Images use native image inputs; display spans preserve structured system messages. */
export function encodeInput(message: SessionMessage, skills: readonly SessionSkill[]): UserInput[] {
  if (message.role === "system")
    return [
      displayText(systemMessagePrompt(message.content), encodeSystemMessage(message.content)),
    ];

  const input: UserInput[] = [{ type: "text", text: message.content, text_elements: [] }];
  const skillName = message.content.match(/^\/([^\s]+)(?:\s|$)/)?.[1];
  const skill = skills.find((candidate) => candidate.name === skillName);
  if (skill?.path) input.push({ type: "skill", name: skill.name, path: skill.path });
  for (const image of message.attachments ?? [])
    input.push({ type: "image", url: `data:${image.mimeType};base64,${image.base64}` });
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
    const image = readImage(input);
    if (image) attachments.push(image);
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

/** Imported CLI conversations can reference local images instead of data URLs. */
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
                  content: await Promise.all(item.content.map(hydrateNativeImage)),
                },
          ),
        ),
      })),
    ),
  };
}

async function hydrateNativeImage(input: UserInput): Promise<UserInput> {
  if (input.type !== "localImage") return input;
  const file = Bun.file(input.path);
  try {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    return { type: "image", url: `data:${file.type || "image/png"};base64,${data}` };
  } catch {
    return {
      type: "text",
      text: `[Unavailable image attachment: ${input.path}]`,
      text_elements: [],
    };
  }
}

function readImage(input: UserInput): Attachment | undefined {
  if (input.type !== "image") return undefined;
  const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(input.url);
  return match ? { mimeType: match[1]!, base64: match[2]! } : undefined;
}

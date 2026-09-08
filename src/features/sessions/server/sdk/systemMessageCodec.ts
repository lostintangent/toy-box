import { sessionSystemMessageSchema, systemMessagePrompt } from "@sessions/model/systemMessages";
import type { SessionSystemMessage } from "@sessions/model";

const PREFIX = "toybox-system:";

/** Keep model instructions distinct from the durable representation projected into Toy Box. */
export function toSdkSystemMessage(message: SessionSystemMessage) {
  return {
    prompt: systemMessagePrompt(message),
    displayPrompt: `${PREFIX}${JSON.stringify(message)}`,
  };
}

/** Recover a system message from displayed SDK history, or undefined for ordinary user text. */
export function fromSdkSystemMessage(content: string): SessionSystemMessage | undefined {
  if (!content.startsWith(PREFIX)) return undefined;

  try {
    const result = sessionSystemMessageSchema.safeParse(JSON.parse(content.slice(PREFIX.length)));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

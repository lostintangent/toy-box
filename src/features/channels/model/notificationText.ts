import { Lexer, type Token, type Tokens } from "marked";
import { parseEntities } from "parse-entities";
import type { ChannelConversationMessage, ChannelTask } from ".";
import { withoutLeadingMentions } from "./agent";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const notificationBodyLimit = 400;
export const notificationWaitingBody = "Your team is waiting for your reply.";

/** Mirrors ChannelKit.NotificationText, including grapheme and word-boundary truncation. */
export function notificationRequestBody(
  message: Pick<ChannelConversationMessage, "content" | "attachments">,
  agents: readonly { name: string }[],
): string {
  const stripped = withoutLeadingMentions(message.content, agents);
  const text = /^(\s*@[a-zA-Z0-9][a-zA-Z0-9-]*[\s,:]*)+$/.test(stripped)
    ? ""
    : notificationPlainText(stripped);
  if (text) return truncateNotificationText(text);
  const attachments = message.attachments ?? [];
  if (!attachments.length) return notificationWaitingBody;
  const images = attachments.every((attachment) =>
    "mimeType" in attachment
      ? attachment.mimeType.startsWith("image/")
      : /\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|ico|svg)$/i.test(attachment.name),
  );
  return attachments.length === 1
    ? images
      ? "Sent an image"
      : "Sent a file"
    : `Sent ${attachments.length} ${images ? "images" : "files"}`;
}

export function truncateNotificationText(text: string, limit = notificationBodyLimit): string {
  const characters = Array.from(graphemes.segment(text), ({ segment }) => segment);
  if (characters.length <= limit) return text;
  const prefix = characters.slice(0, limit - 1);
  let boundary = prefix.length - 1;
  while (boundary >= 0 && !/\s/u.test(prefix[boundary]!)) boundary--;
  return (
    (boundary < 0 ? prefix : prefix.slice(0, boundary)).join("").replace(/[\s,;:.-]+$/u, "") +
    "\u2026"
  );
}

export function notificationCompletionBody(tasks: readonly Pick<ChannelTask, "title">[]): string {
  if (!tasks.length) return "All tasks completed";
  if (tasks.length === 1) return `Completed \u201c${tasks[0]!.title}\u201d`;
  return `All ${tasks.length} tasks completed`;
}

export function notificationPlainText(markdown: string): string {
  return blocks(Lexer.lex(markdown))
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
}

function blocks(tokens: Token[]): string[] {
  return tokens.flatMap((token): string[] => {
    switch (token.type) {
      case "space":
      case "hr":
        return [];
      case "code":
        return [token.text];
      case "blockquote":
        return blocks(token.tokens ?? []);
      case "list":
        return token.items.flatMap((item: Tokens.ListItem) =>
          blocks(item.tokens).map((text, index) => (index ? text : `\u2022 ${text}`)),
        );
      case "table":
        return [
          [token.header, ...token.rows]
            .map((row: Tokens.TableCell[]) => row.map((cell) => inline(cell.tokens)).join("  "))
            .join("\n"),
        ];
      case "paragraph":
      case "heading":
      case "text":
        return [inline(token.tokens ?? Lexer.lexInline(token.text))];
      default:
        return [inline(Lexer.lexInline(token.raw))];
    }
  });
}

function inline(tokens: Token[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "strong":
        case "em":
        case "del":
        case "link":
          return inline(token.tokens ?? []);
        case "codespan":
          return token.text;
        case "br":
          return "\n";
        case "text":
        case "escape":
        case "html":
        case "image":
          return parseEntities(token.text);
        default:
          return parseEntities(token.raw);
      }
    })
    .join("");
}

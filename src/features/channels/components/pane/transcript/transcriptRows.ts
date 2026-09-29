import {
  isChannelSystemMessage,
  type ChannelConversationMessage,
  type ChannelMessage,
  type ChannelSystemMessage,
} from "@channels/model";

// Consecutive messages from one agent within this window share a header.
const RUN_WINDOW_MS = 10 * 60 * 1000;

type TranscriptRowContent =
  | { type: "user"; messages: ChannelConversationMessage[] }
  | { type: "agent"; agentId: string; messages: ChannelConversationMessage[] }
  | { type: "system"; messages: ChannelSystemMessage[] };

/** One transcript row, and the dividers that precede it. */
export type TranscriptRow = TranscriptRowContent & {
  /** The row begins a day, as the first loaded row always does. */
  startsDay: boolean;
  /** The row begins the messages that were unread when the reader arrived, after earlier rows. */
  startsUnread: boolean;
};

/**
 * The transcript's rows. A user message stands alone, one agent's consecutive messages form a run,
 * and membership changes merge, as do one agent's artifact shares. Rows never span a day or the
 * start of unread messages, so dividers always fall between rows. Requests mark the message they
 * reference instead of rendering as rows of their own.
 */
export function transcriptRows(
  messages: readonly ChannelMessage[],
  unreadAfter?: number,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const message of messages) {
    if (isChannelSystemMessage(message) && message.content.type === "user_attention_requested") {
      continue;
    }
    const row = rows.at(-1);
    const previous = row?.messages.at(-1);
    const startsDay = !previous || !isSameDay(previous.timestamp, message.timestamp);
    const startsUnread =
      previous !== undefined &&
      unreadAfter !== undefined &&
      previous.sequence <= unreadAfter &&
      message.sequence > unreadAfter;
    if (!row || startsDay || startsUnread || !extendRow(row, message)) {
      rows.push({ ...startRow(message), startsDay, startsUnread });
    }
  }
  return rows;
}

/** "Today", "Yesterday", or the full day, adding the year only when it isn't the current one. */
export function transcriptDayLabel(date: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function startRow(message: ChannelMessage): TranscriptRowContent {
  if (isChannelSystemMessage(message)) return { type: "system", messages: [message] };
  const { sender } = message;
  return sender.type === "agent"
    ? { type: "agent", agentId: sender.agentId, messages: [message] }
    : { type: "user", messages: [message] };
}

/** Adds the message to the row it continues: the same agent's run, or matching system messages. */
function extendRow(row: TranscriptRow, message: ChannelMessage): boolean {
  if (row.type === "system" && isChannelSystemMessage(message)) {
    const group = systemMessageGroup(message);
    if (group === undefined || group !== systemMessageGroup(row.messages[0]!)) return false;
    row.messages.push(message);
    return true;
  }
  if (row.type !== "agent" || isChannelSystemMessage(message)) return false;
  if (message.sender.type !== "agent" || message.sender.agentId !== row.agentId) return false;
  const gap = Date.parse(message.timestamp) - Date.parse(row.messages.at(-1)!.timestamp);
  if (gap > RUN_WINDOW_MS) return false;
  row.messages.push(message);
  return true;
}

/** Membership changes merge, as do one agent's artifact shares; other system messages stand alone. */
function systemMessageGroup({ content }: ChannelSystemMessage): string | undefined {
  if (content.type === "member_joined" || content.type === "member_left") return content.type;
  if (content.type === "artifact_shared" && content.actor.type === "agent") {
    return `${content.type}:${content.actor.agentId}`;
  }
  return undefined;
}

function isSameDay(left: string, right: string): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

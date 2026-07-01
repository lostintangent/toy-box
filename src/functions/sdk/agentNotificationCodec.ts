import {
  parseAgentNotification,
  AGENT_NOTIFICATION_TYPE_INSTRUCTIONS,
} from "@/lib/session/agentNotifications";
import type { AgentNotification } from "@/types";

const MARKER_OPEN = "<toybox-notification>";
const MARKER_CLOSE = "</toybox-notification>";

/** Serialize a domain notification into the SDK prompt marker transport. */
export function encodeSdkAgentNotification(notification: AgentNotification): string {
  return `${MARKER_OPEN}${JSON.stringify(notification)}${MARKER_CLOSE}`;
}

/** Recover a notification from an SDK user-message marker, or undefined if it is normal text. */
export function decodeSdkAgentNotification(content: string): AgentNotification | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith(MARKER_OPEN) || !trimmed.endsWith(MARKER_CLOSE)) return undefined;

  try {
    return parseAgentNotification(
      JSON.parse(trimmed.slice(MARKER_OPEN.length, trimmed.length - MARKER_CLOSE.length)),
    );
  } catch {
    return undefined;
  }
}

/** SDK system-message guidance for the marker transport used to deliver notifications. */
export const SDK_AGENT_NOTIFICATION_INSTRUCTIONS = [
  `The user's messages may contain markers describing actions they took in the Toy Box UI, ` +
    `written as \`${MARKER_OPEN}{"type":"<type>",...args}${MARKER_CLOSE}\`. Treat each as a ` +
    `user-initiated event and act on it according to its type:`,
  ...AGENT_NOTIFICATION_TYPE_INSTRUCTIONS,
].join("\n");

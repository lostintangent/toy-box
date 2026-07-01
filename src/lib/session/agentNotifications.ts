// Agent notifications: a side channel for delivering user actions/events to a
// session's agent out of band. Each notification type is declared once as a
// registry descriptor; validation, labels, coalescing, and per-type guidance are
// derived from that registry so adding a type touches one policy table.

import { z } from "zod";
import { getPathBasename } from "@/lib/paths";
import type { AgentNotification } from "@/types";

const REGISTRY: NotificationRegistry = {
  artifact_edited: {
    schema: z.object({ type: z.literal("artifact_edited"), path: z.string().min(1) }),
    instruction:
      "The user edited the artifact at the given `path`. Review its latest contents and respond only if a follow-up would help.",
    label: (notification) => `Edited artifact (${getPathBasename(notification.path)})`,
    coalesceKey: (notification) => `artifact_edited:${notification.path}`,
  },
};

type NotificationDescriptor<N extends AgentNotification> = {
  schema: z.ZodType<N>;
  /** How the agent should interpret this type — stated once in the system message. */
  instruction: string;
  /** Short label for the transcript / queue pill. */
  label: (notification: N) => string;
  /** Key that collapses equivalent queued notifications (e.g. repeated edits to one file). */
  coalesceKey: (notification: N) => string;
};

type NotificationType = AgentNotification["type"];

// Exactly one descriptor per type — the mapped type makes a missing entry a
// compile error, so a notification can't be half-registered.
type NotificationRegistry = {
  [T in NotificationType]: NotificationDescriptor<Extract<AgentNotification, { type: T }>>;
};

function descriptorFor<N extends AgentNotification>(notification: N): NotificationDescriptor<N> {
  return REGISTRY[notification.type] as unknown as NotificationDescriptor<N>;
}

export function parseAgentNotification(value: unknown): AgentNotification | undefined {
  const type = (value as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !(type in REGISTRY)) return undefined;

  const result = REGISTRY[type as NotificationType].schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Short label for rendering a notification in the transcript or queue. */
export function notificationLabel(notification: AgentNotification): string {
  return descriptorFor(notification).label(notification);
}

/** Key that collapses equivalent notifications so the agent isn't nudged twice. */
export function notificationCoalesceKey(notification: AgentNotification): string {
  return descriptorFor(notification).coalesceKey(notification);
}

/** Validates a notification payload for the delivery server function. */
export const agentNotificationSchema = z.custom<AgentNotification>(
  (value) => parseAgentNotification(value) !== undefined,
);

/** Domain-level per-type guidance. Transport-specific instructions live in the SDK codec. */
export const AGENT_NOTIFICATION_TYPE_INSTRUCTIONS = Object.entries(REGISTRY).map(
  ([type, descriptor]) => `- ${type}: ${descriptor.instruction}`,
);

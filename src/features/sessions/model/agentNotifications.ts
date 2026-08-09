// Agent notifications: a side channel for delivering user actions/events to a
// session's agent out of band. Each notification type is declared once as a
// registry descriptor; validation, labels, coalescing, and per-type guidance are
// derived from that registry so adding a type touches one policy table.

import { z } from "zod";
import { workspaceFileId, workspaceFileSchema } from "@files/model";
import { getPathBasename } from "@files/model/paths";

type NotificationSchema = z.ZodType<{ type: string }>;

type NotificationDescriptor<Schema extends NotificationSchema> = {
  schema: Schema;
  /** How the agent should interpret this type — stated once in the system message. */
  instruction: string;
  /** Short label for the transcript / queue pill. */
  label: (notification: z.infer<Schema>) => string;
  /** Key that collapses equivalent queued notifications (e.g. repeated edits to one file). */
  coalesceKey: (notification: z.infer<Schema>) => string;
};

function defineNotification<Schema extends NotificationSchema>(
  descriptor: NotificationDescriptor<Schema>,
): NotificationDescriptor<Schema> {
  return descriptor;
}

const REGISTRY = {
  file_edited: defineNotification({
    schema: z.object({ type: z.literal("file_edited"), file: workspaceFileSchema }),
    instruction:
      "The user edited a file open in Toy Box. A `session` file's `path` is relative to that session's files folder (usually your own); a `machine` file's `path` is an absolute host path. Review its latest contents and respond only if a follow-up would help.",
    label: (notification) => `Edited ${getPathBasename(notification.file.path)}`,
    coalesceKey: (notification) => `file_edited:${workspaceFileId(notification.file)}`,
  }),
};

export const agentNotificationSchema = REGISTRY.file_edited.schema;
export type AgentNotification = z.infer<typeof agentNotificationSchema>;

function descriptorFor(notification: AgentNotification) {
  return REGISTRY[notification.type];
}

export function parseAgentNotification(value: unknown): AgentNotification | undefined {
  const result = agentNotificationSchema.safeParse(value);
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

/** Domain-level per-type guidance. Transport-specific instructions live in the SDK codec. */
export const AGENT_NOTIFICATION_TYPE_INSTRUCTIONS = Object.entries(REGISTRY).map(
  ([type, descriptor]) => `- ${type}: ${descriptor.instruction}`,
);

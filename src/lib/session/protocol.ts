// Session client/server protocol. Server functions validate these schemas at
// runtime, and client/server code consume the inferred types that matter so
// the boundary cannot drift.

import { z } from "zod";
import { agentNotificationSchema } from "@/lib/session/agentNotifications";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

export const sessionInputSchema = z.object({
  sessionId: z.string(),
});

export const listSkillsInputSchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const renameSessionInputSchema = sessionInputSchema.extend({
  name: z.string().trim().min(1).max(100),
});

export const createDraftSessionInputSchema = sessionInputSchema.extend({
  artifact: z
    .object({
      path: z.string(),
      content: z.string(),
    })
    .optional(),
  hyper: z.literal(true).optional(),
});

export const sessionAttachmentsSchema = z
  .array(
    z.object({
      displayName: z.string(),
      mimeType: z.string(),
      base64: z.string(),
    }),
  )
  .optional();

const sessionMessageInputSchema = z
  .object({
    id: z.string().optional(),
    content: z.string(),
    attachments: sessionAttachmentsSchema,
    model: modelConfigurationSchema.optional(),
  })
  .refine(
    (message) => message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0,
    { message: "A prompt or attachment is required" },
  );

const sessionLocationSchema = z.object({
  directory: z.string().optional(),
  useWorktree: z.boolean().optional(),
});

const streamSessionBaseSchema = sessionInputSchema.extend({
  afterEventId: z.number().int().nonnegative().optional(),
});

const sessionSubscriptionModeSchema = z.enum(["active", "passive"]);

// Every request identifies the observed session/cursor. A message optionally
// mutates that same stream; location is only established with its first message.
export const streamSessionRequestSchema = streamSessionBaseSchema.and(
  z.union([
    z.object({
      message: sessionMessageInputSchema,
      location: sessionLocationSchema.optional(),
    }),
    z.object({
      message: z.never().optional(),
      location: z.never().optional(),
      mode: sessionSubscriptionModeSchema.optional(),
    }),
  ]),
);

const sessionLaunchInputSchema = sessionLocationSchema.extend({
  message: sessionMessageInputSchema,
});

export const createSessionInputSchema = sessionLaunchInputSchema;
export const dispatchInboxTaskInputSchema = sessionLaunchInputSchema;

export const deliverMessageInputSchema = sessionInputSchema.extend({
  message: sessionMessageInputSchema,
});

export const notifyAgentInputSchema = sessionInputSchema.extend({
  notification: agentNotificationSchema,
});

export const queuedMessageInputSchema = sessionInputSchema.extend({
  queuedMessageId: z.string(),
});

export type SessionMessageInput = z.infer<typeof sessionMessageInputSchema>;
export type SessionSubscriptionMode = z.infer<typeof sessionSubscriptionModeSchema>;
export type StreamSessionRequest = z.infer<typeof streamSessionRequestSchema>;

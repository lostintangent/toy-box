// Session client/server protocol. Server functions validate these schemas at
// runtime, and client/server code consume the inferred types that matter so
// the boundary cannot drift.

import { z } from "zod";
import { agentMentionSchema } from "@agents/model";
import { modelConfigurationSchema } from "./modelConfiguration";
import { sessionSystemMessageSchema } from "./systemMessages";

export const sessionTypeSchema = z.enum([
  "standard",
  "automation",
  "inbox",
  "hyper",
  "worker",
  "agent",
]);

export type SessionType = z.infer<typeof sessionTypeSchema>;

export const sessionInputSchema = z.object({
  sessionId: z.string(),
});

export const waitForSessionInputSchema = sessionInputSchema.extend({
  timeoutMs: z.number().int().nonnegative().max(300_000).optional(),
});

export const listSkillsInputSchema = z.object({
  cwd: z.string().min(1).optional(),
  sessionType: sessionTypeSchema.optional(),
});

export const sessionNameSchema = z.string().trim().min(1).max(100);

export const renameSessionInputSchema = sessionInputSchema.extend({
  name: sessionNameSchema,
});

export const rewindSessionInputSchema = sessionInputSchema.extend({
  timestamp: z.string().min(1),
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

export const attachmentSchema = z.object({
  displayName: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const messageAttachmentsSchema = z.array(attachmentSchema);

export const sessionMessageSchema = z
  .object({
    clientId: z.string().optional(),
    content: z.string(),
    attachments: messageAttachmentsSchema.optional(),
    model: modelConfigurationSchema.optional(),
    agentMentions: z.array(agentMentionSchema).max(50).optional(),
  })
  .refine(
    (message) => message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0,
    { message: "A prompt or attachment is required" },
  );

export type SessionMessage = z.infer<typeof sessionMessageSchema>;

const sessionLocationSchema = z.object({
  directory: z.string().optional(),
  useWorktree: z.boolean().optional(),
});

const streamSessionBaseSchema = sessionInputSchema.extend({
  afterEventId: z.number().int().nonnegative().optional(),
});

const sessionSubscriptionModeSchema = z.enum(["active", "passive"]);

// Every request identifies the streamed session and replay cursor. A message
// optionally mutates that same stream; location is established only with its first message.
export const streamSessionRequestSchema = streamSessionBaseSchema.and(
  z.union([
    z.object({
      message: sessionMessageSchema,
      location: sessionLocationSchema.optional(),
    }),
    z.object({
      message: z.never().optional(),
      location: z.never().optional(),
      mode: sessionSubscriptionModeSchema.optional(),
    }),
  ]),
);

export const sessionLaunchSchema = sessionLocationSchema.extend({
  message: sessionMessageSchema,
});

export type SessionLaunch = z.infer<typeof sessionLaunchSchema>;

export const deliverMessageInputSchema = sessionInputSchema.extend({
  message: sessionMessageSchema,
  immediate: z.literal(true).optional(),
});

export const sendSystemMessageInputSchema = sessionInputSchema.extend({
  message: sessionSystemMessageSchema,
});

export const queuedMessageInputSchema = sessionInputSchema.extend({
  clientId: z.string(),
});

const sessionQuestionAnswerSchema = z.object({
  requestId: z.string().min(1),
  answer: z.string().trim().min(1),
  wasFreeform: z.boolean(),
});

export const answerSessionQuestionInputSchema = sessionInputSchema.extend(
  sessionQuestionAnswerSchema.shape,
);

export type SessionQuestionAnswer = z.infer<typeof sessionQuestionAnswerSchema>;
export type SessionSubscriptionMode = z.infer<typeof sessionSubscriptionModeSchema>;
export type StreamSessionRequest = z.infer<typeof streamSessionRequestSchema>;

// Session client/server protocol. Server functions validate these schemas at
// runtime, and client/server code consume the inferred types that matter so
// the boundary cannot drift.

import { z } from "zod";
import { modelConfigurationSchema } from "@providers/model";
import { attachmentsSchema } from "@/shared/attachments/model";

export type SessionType = "standard" | "automation" | "hyper" | "worker";

export const sessionInputSchema = z.object({
  sessionId: z.string(),
});

export const waitForSessionInputSchema = sessionInputSchema.extend({
  timeoutMs: z.number().int().nonnegative().max(300_000).optional(),
});

export const listSkillsInputSchema = z.object({
  provider: z.string().optional(),
  cwd: z.string().min(1).optional(),
});

export const resolveSessionContextInputSchema = z.object({
  directory: z.string().min(1),
});

export const sessionNameSchema = z.string().trim().min(1).max(100);

export const renameSessionInputSchema = sessionInputSchema.extend({
  name: sessionNameSchema,
});

export const rewindSessionInputSchema = sessionInputSchema.extend({
  timestamp: z.string().min(1),
});

export const querySessionMessagesInputSchema = sessionInputSchema.extend({
  before: z.number().int().positive(),
});

export const createSessionInputSchema = sessionInputSchema.extend({
  artifact: z
    .object({
      path: z.string(),
      content: z.string(),
    })
    .optional(),
  hyper: z.literal(true).optional(),
});

export const sessionMessageSchema = z
  .object({
    clientId: z.string().optional(),
    content: z.string(),
    attachments: attachmentsSchema.optional(),
    model: modelConfigurationSchema.optional(),
    immediate: z.literal(true).optional(),
  })
  .refine(
    (message) => message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0,
    { message: "A prompt or attachment is required" },
  );

export const sessionLocationSchema = z.object({
  directory: z.string().optional(),
  useWorktree: z.boolean().optional(),
});

export type SessionLocation = z.infer<typeof sessionLocationSchema>;

export const sessionLaunchSchema = z.object({
  message: sessionMessageSchema,
  location: sessionLocationSchema.optional(),
});

export type SessionLaunch = z.infer<typeof sessionLaunchSchema>;

// A location establishes the session with its first message.
export const deliverMessageInputSchema = sessionInputSchema.extend(sessionLaunchSchema.shape);

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

import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

const checkSessionStatus = defineTool("check_session_status", {
  description:
    "Checks another session's current runtime status. " +
    "Returns whether it currently has an active stream and how many prompts are queued.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to check"),
  }),
  skipPermission: true,
  handler: async ({ sessionId }) => {
    const { SessionStream } = await import("@/functions/runtime/stream");
    const stream = SessionStream.get(sessionId);
    return JSON.stringify({
      running: stream !== undefined,
      queuedCount: stream?.getQueuedMessages().length ?? 0,
    });
  },
});

const waitForSessions = defineTool("wait_for_sessions", {
  description:
    "Waits for one or more sessions' current runtime streams to complete before returning. " +
    "Returns each stream's completion status and latest assistant response when available.",
  parameters: z.object({
    sessionIds: z.array(z.string()).min(1).describe("One or more session IDs to wait for"),
    timeoutMs: z
      .number()
      .int()
      .nonnegative()
      .max(300000)
      .optional()
      .describe("Optional maximum time to wait in milliseconds"),
  }),
  skipPermission: true,
  handler: async ({ sessionIds, timeoutMs }) => {
    const { SessionStream } = await import("@/functions/runtime/stream");
    return JSON.stringify({
      responses: await Promise.all(
        sessionIds.map(async (sessionId) => {
          const completion = await SessionStream.waitForCompletion(sessionId, timeoutMs);
          return { sessionId, ...completion };
        }),
      ),
    });
  },
});

const deliverMessage = defineTool("deliver_message", {
  description:
    "Delivers a message to another session. " +
    "If that session is already running, the message is queued automatically. " +
    "If it is idle, the session is resumed and the message starts immediately.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to receive the message"),
    message: z.string().describe("The message to deliver"),
    model: modelConfigurationSchema
      .optional()
      .describe("Optional model and reasoning override for this message"),
  }),
  skipPermission: true,
  handler: async ({ sessionId, message, model }) => {
    const { deliverSessionMessage } = await import("@/functions/runtime/stream");

    const { disposition } = await deliverSessionMessage(sessionId, {
      content: message,
      model,
    });

    return JSON.stringify({ disposition });
  },
});

export const coordinationTools = [checkSessionStatus, waitForSessions, deliverMessage];

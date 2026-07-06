import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { SessionStream } from "@/functions/runtime/stream";
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
    "Returns the latest assistant response when available and an error when a session fails or times out.",
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

const sendToSession = defineTool("send_to_session", {
  description:
    "Sends a prompt to another session. " +
    "If that session is already running, the prompt is queued automatically. " +
    "If it is idle, the session is resumed and the prompt is sent immediately.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to send the prompt to"),
    prompt: z.string().describe("The prompt to deliver to the target session"),
    modelConfiguration: modelConfigurationSchema
      .optional()
      .describe("Optional model configuration override for this prompt"),
  }),
  skipPermission: true,
  handler: async ({ sessionId, prompt, modelConfiguration }) => {
    const { deliverSessionMessage } = await import("@/functions/runtime/stream");

    await deliverSessionMessage({
      sessionId,
      message: {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        modelConfiguration,
      },
    });

    return JSON.stringify({ accepted: true });
  },
});

export const coordinationTools = [checkSessionStatus, waitForSessions, sendToSession];

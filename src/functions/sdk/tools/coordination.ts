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
    "Waits for one or more sessions' current runtime streams to end before returning. " +
    "Returns the final assistant response from each completed session in the same order.",
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
        sessionIds.map(async (sessionId) => ({
          sessionId,
          response: await SessionStream.waitForClose(sessionId, timeoutMs),
        })),
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
    const { sendOrQueueSessionMessage } = await import("@/functions/runtime/stream");

    await sendOrQueueSessionMessage({
      sessionId,
      prompt,
      modelConfiguration,
    });

    return JSON.stringify({ accepted: true });
  },
});

export const coordinationTools = [checkSessionStatus, waitForSessions, sendToSession];

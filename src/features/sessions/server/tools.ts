import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { modelConfigurationSchema } from "@sessions/model/modelConfiguration";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";

const checkSessionStatus = defineTool("check_session_status", {
  description:
    "Checks another session's current runtime status. " +
    "Returns whether it currently has an active stream and how many prompts are queued.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to check"),
  }),
  skipPermission: true,
  handler: async ({ sessionId }) => {
    const { getSessionRuntimeStatus } = await import("@sessions/server/runtime");
    return JSON.stringify(getSessionRuntimeStatus(sessionId));
  },
});

const waitForSessions = defineTool("wait_for_sessions", {
  description:
    "Waits for one or more sessions' current executions to complete before returning. " +
    "Returns each completion status and latest assistant response when available; timing out does not abort the session.",
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
    const { waitForSession } = await import("@sessions/server/runtime");
    return JSON.stringify({
      responses: await Promise.all(
        sessionIds.map(async (sessionId) => {
          const completion = await waitForSession(sessionId, timeoutMs);
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
    const { deliverSessionMessage } = await import("@sessions/server/runtime");

    const { disposition } = await deliverSessionMessage(sessionId, {
      content: message,
      model,
    });

    return JSON.stringify({ disposition });
  },
});

export const coordinationTools = [checkSessionStatus, waitForSessions, deliverMessage];

const sessionExecutionParameters = {
  model: modelConfigurationSchema
    .optional()
    .describe("Optional model and reasoning configuration for the new session."),
  directory: z.string().optional().describe("Optional working directory for the new session."),
  useWorktree: z
    .boolean()
    .optional()
    .describe("Whether to create the session in a git worktree. Defaults to false."),
};

const createSessionTool = defineTool("create_session", {
  description:
    "Creates an independent top-level session for work that should remain available outside this Hyper session. " +
    "The session appears in the normal session list and is not deleted with this Hyper session. Model and directory are used only when explicitly supplied; omitted values use normal new-session defaults. " +
    "It does not open by default: `open` defaults to false. Set it to true to open the session immediately, or call `open_session` later with the returned session ID.",
  parameters: z.object({
    prompt: z.string().describe("The initial prompt to send to the new session"),
    ...sessionExecutionParameters,
    open: z
      .boolean()
      .optional()
      .describe("Whether to open the new session as a linked pane. Defaults to false."),
  }),
  skipPermission: true,
  handler: async (args) => {
    const { createSession } = await import("@sessions/server/runtime");
    const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;

    await createSession(
      sessionId,
      { content: args.prompt, model: args.model },
      {
        directory: args.directory,
        sessionType: "standard",
        useWorktree: args.useWorktree ?? false,
      },
    );

    return JSON.stringify({ sessionId, opened: args.open ?? false });
  },
});

const openSession = defineTool("open_session", {
  description:
    "Opens another session alongside this one in the sessions grid. " +
    "Use this when the user asks to view, compare, or work with multiple sessions at once. " +
    "The grid supports up to 4 sessions at a time.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to open alongside this one"),
  }),
  skipPermission: true,
  handler: ({ sessionId }) => `Session ${sessionId} opened.`,
});

const closeSession = defineTool("close_session", {
  description:
    "Closes a session from the sessions grid. " +
    "The session itself is not deleted, just removed from the visible grid.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to remove from the grid"),
  }),
  skipPermission: true,
  handler: ({ sessionId }) => `Session ${sessionId} closed.`,
});

const deleteSessionTool = defineTool("delete_session", {
  description:
    "Deletes another session when it is no longer needed. " +
    "This removes the session from storage and cleans up its runtime state.",
  parameters: z.object({
    sessionId: z.string().describe("The ID of the session to delete"),
  }),
  skipPermission: true,
  handler: async ({ sessionId }) => {
    const { deleteSession } = await import("@sessions/server/runtime");

    await deleteSession(sessionId);
    return JSON.stringify({ deleted: true });
  },
});

export const hyperLifecycleTools = [createSessionTool];
export const lifecycleTools = [deleteSessionTool];
export const sessionLayoutTools = [openSession, closeSession];

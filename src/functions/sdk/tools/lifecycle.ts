import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";

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

const createWorkerSessionTool = defineTool("create_worker_session", {
  description:
    "Creates a retained child worker session owned by the current session for delegated or parallel work. " +
    "The worker automatically opens as a linked pane, inherits the current model and directory by default, and remains available for waiting, inspection, or follow-up messages after it completes. " +
    "It is deleted with the current session; delete it sooner when it is no longer needed.",
  parameters: z.object({
    task: z.string().describe("The task to delegate to the new worker"),
    ...sessionExecutionParameters,
  }),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { spawnWorker } = await import("@/functions/runtime/workers");
    const { sessionId } = await spawnWorker({
      parentSessionId: invocation.sessionId,
      task: args.task,
      model: args.model,
      directory: args.directory,
      useWorktree: args.useWorktree,
      retained: true,
    });

    return JSON.stringify({ sessionId, opened: true });
  },
});

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
    const { createSession } = await import("@/functions/runtime/stream");
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
    const { deleteSession } = await import("@/functions/state/session/registry");

    await deleteSession(sessionId);
    return JSON.stringify({ deleted: true });
  },
});

export const hyperLifecycleTools = [createSessionTool];
export const lifecycleTools = [createWorkerSessionTool, deleteSessionTool];
export const sessionLayoutTools = [openSession, closeSession];

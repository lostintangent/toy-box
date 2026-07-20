import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

const createSessionTool = defineTool("create_session", {
  description:
    "Creates a retained worker session for delegated or parallel work. " +
    "The worker inherits the current session's model and directory by default and remains available for waiting, inspection, or follow-up messages after it completes. " +
    "Delete it when it is no longer needed. By default it does not create a worktree.",
  parameters: z.object({
    task: z.string().describe("The task to delegate to the new worker"),
    model: modelConfigurationSchema
      .optional()
      .describe("Optional model and reasoning override for the worker"),
    directory: z.string().optional().describe("Optional working directory override for the worker"),
    useWorktree: z
      .boolean()
      .optional()
      .describe("Whether to create the worker in a git worktree. Defaults to false."),
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

    return JSON.stringify({ sessionId });
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

export const lifecycleTools = [createSessionTool, deleteSessionTool];
export const sessionLayoutTools = [openSession, closeSession];

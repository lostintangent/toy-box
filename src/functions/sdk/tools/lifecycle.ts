import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { readSessionContext } from "@/functions/sdk/client";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

const createSessionTool = defineTool("create_session", {
  description:
    "Creates a new companion session for delegated or parallel work. " +
    "The new session inherits the current session's model and directory by default. " +
    "By default it does not create a worktree.",
  parameters: z.object({
    prompt: z.string().describe("The initial prompt to send to the new session"),
    model: modelConfigurationSchema
      .optional()
      .describe("Optional model and reasoning override for the new session"),
    directory: z
      .string()
      .optional()
      .describe("Optional working directory override for the new session"),
    useWorktree: z
      .boolean()
      .optional()
      .describe("Whether to create the new session in a git worktree. Defaults to false."),
  }),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { createSession, SessionStream } = await import("@/functions/runtime/stream");
    const inheritedWorkspaceContext =
      args.directory === undefined ? await readSessionContext(invocation.sessionId) : undefined;
    const inheritedExecutionDirectory =
      args.directory ?? inheritedWorkspaceContext?.workingDirectory;
    const inheritedModel =
      args.model ?? SessionStream.get(invocation.sessionId)?.getSessionState().model;
    const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
    await createSession(
      sessionId,
      {
        content: args.prompt,
        model: inheritedModel,
      },
      {
        directory: inheritedExecutionDirectory,
        useWorktree: args.useWorktree ?? false,
        parentSessionId: invocation.sessionId,
        initialContext: inheritedWorkspaceContext,
        sessionType: "child",
      },
    );

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

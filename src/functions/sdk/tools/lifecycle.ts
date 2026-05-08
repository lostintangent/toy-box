import type { SessionContext } from "@github/copilot-sdk";
import { defineTool } from "@github/copilot-sdk";
import { homedir } from "node:os";
import { z } from "zod";
import { SESSION_ID_PREFIX, readSessionContextFromEvents } from "@/functions/sdk/client";

function normalizeInheritedWorkspaceContext(context?: SessionContext): SessionContext | undefined {
  const cwd = context?.cwd;
  if (!cwd || (cwd === homedir() && !context?.gitRoot && !context?.repository)) return undefined;
  return {
    cwd,
    gitRoot: context?.gitRoot,
    repository: context?.repository,
    branch: context?.branch,
  };
}

const createSession = defineTool("create_session", {
  description:
    "Creates a new companion session and opens it alongside the current one. " +
    "The new session inherits the current session's model and directory by default. " +
    "By default it does not create a worktree.",
  parameters: z.object({
    prompt: z.string().describe("The initial prompt to send to the new session"),
    model: z.string().optional().describe("Optional model override for the new session"),
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
    const [{ SessionStream }, { createAndStartSession }] = await Promise.all([
      import("@/functions/runtime/stream"),
      import("@/functions/runtime/sessionLauncher"),
    ]);
    const inheritedWorkspaceContext =
      args.directory === undefined
        ? normalizeInheritedWorkspaceContext(
          await readSessionContextFromEvents(invocation.sessionId),
        )
        : undefined;
    const inheritedExecutionDirectory = args.directory ?? inheritedWorkspaceContext?.cwd;
    const inheritedModel =
      args.model ?? SessionStream.get(invocation.sessionId)?.getSessionState().model;
    const { sessionId } = await createAndStartSession({
      sessionId: `${SESSION_ID_PREFIX}${crypto.randomUUID()}`,
      prompt: args.prompt,
      model: inheritedModel,
      directory: inheritedExecutionDirectory,
      useWorktree: args.useWorktree ?? false,
      ...(inheritedWorkspaceContext ? { initialContext: inheritedWorkspaceContext } : {}),
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
    const { deleteSession } = await import("@/functions/state/sessionCache");

    await deleteSession(sessionId);
    return JSON.stringify({ deleted: true });
  },
});

export const lifecycleTools = [createSession, openSession, closeSession, deleteSessionTool];

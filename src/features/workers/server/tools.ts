import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { modelConfigurationSchema } from "@sessions/model/modelConfiguration";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";
import { workerNameSchema } from "../model";

const createWorkerSessionTool = defineTool("create_worker_session", {
  description:
    "Creates a child worker session owned by the current session for delegated or parallel work. " +
    "It inherits the current model and directory by default. Durable children open as linked panes and remain available for follow-up; ephemeral children run headlessly and are deleted after their initial execution. " +
    "Every child is deleted with the current session.",
  parameters: z.object({
    task: z.string().describe("The task to delegate to the new worker"),
    name: workerNameSchema
      .optional()
      .describe("A concise, durable display name for the worker's role or assignment."),
    model: modelConfigurationSchema
      .optional()
      .describe("Optional model and reasoning configuration for the new session."),
    directory: z.string().optional().describe("Optional working directory for the new session."),
    useWorktree: z
      .boolean()
      .optional()
      .describe("Whether to create the session in a git worktree. Defaults to false."),
    ephemeral: z
      .boolean()
      .optional()
      .describe("Delete the child after its initial execution. Defaults to false."),
  }),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { spawnWorker } = await import("@workers/server");
    const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
    const ephemeral = args.ephemeral ?? false;
    await spawnWorker({
      worker: {
        type: "session",
        sessionId,
        parentSessionId: invocation.sessionId,
        ephemeral,
        ...(args.name === undefined ? {} : { name: args.name }),
      },
      message: { content: args.task, model: args.model },
      directory: args.directory,
      useWorktree: args.useWorktree,
    });

    return JSON.stringify({ sessionId, opened: !ephemeral });
  },
});

export const workerTools = [createWorkerSessionTool];

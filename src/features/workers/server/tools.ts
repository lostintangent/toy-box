import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { modelConfigurationSchema } from "@sessions/model/modelConfiguration";
import { workerNameSchema } from "../model";

const spawnWorkerTool = defineTool("spawn_worker", {
  description:
    "Spawns an anonymous worker owned by the current session for delegated or parallel work. " +
    "It inherits the current model and directory by default. Retained children open as linked panes and remain available for follow-up; ephemeral children run headlessly and are deleted after their initial execution. " +
    "Every child is deleted with the current session.",
  parameters: z.object({
    task: z.string().describe("The task to delegate to the new worker"),
    name: workerNameSchema
      .optional()
      .describe("A concise local label for the worker's role or assignment."),
    model: modelConfigurationSchema
      .optional()
      .describe("Optional model and reasoning configuration for the new session."),
    directory: z.string().optional().describe("Optional working directory for the new session."),
    useWorktree: z
      .boolean()
      .optional()
      .describe(
        "Whether to isolate the worker in a git worktree. An ephemeral worker's worktree is discarded with it. Defaults to false.",
      ),
    ephemeral: z
      .boolean()
      .optional()
      .describe(
        "Delete the worker, transcript, and any worktree after its initial execution. Defaults to false.",
      ),
  }),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { spawnSessionWorker } = await import("@workers/server");
    const ephemeral = args.ephemeral ?? false;
    const { sessionId } = await spawnSessionWorker({
      parentSessionId: invocation.sessionId,
      ephemeral,
      ...(args.name === undefined ? {} : { name: args.name }),
      message: { content: args.task, model: args.model },
      directory: args.directory,
      useWorktree: args.useWorktree,
    });

    return JSON.stringify({ sessionId, opened: !ephemeral });
  },
});

export const workerTools = [spawnWorkerTool];

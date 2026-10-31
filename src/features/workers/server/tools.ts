import { defineTool } from "@sessions/server/tools/definition";
import { z } from "zod";
import { modelConfigurationSchema } from "@providers/model";
import { workerNameSchema } from "../model";

const spawnWorkerTool = defineTool("spawn_worker", {
  description:
    "Spawns an anonymous worker owned by the current session for delegated or parallel work. " +
    "It inherits the current model and directory by default. Children appear beneath their parent in the sidebar without opening a pane; use open_session to open one explicitly. " +
    "Retained children remain available for follow-up. Ephemeral children are deleted after their initial execution. " +
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
  handler: async (args, parentSessionId) => {
    const { spawnWorker } = await import("@workers/server");
    const { sessionId } = await spawnWorker({
      owner: { type: "session", parentSessionId },
      retention: args.ephemeral ? "ephemeral" : "durable",
      ...(args.name === undefined ? {} : { name: args.name }),
      message: { content: args.task, model: args.model },
      location: { directory: args.directory, useWorktree: args.useWorktree },
    });

    return JSON.stringify({ sessionId });
  },
});

export const workerTools = [spawnWorkerTool];

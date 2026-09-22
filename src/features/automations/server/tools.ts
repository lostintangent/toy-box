import { defineTool } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  automationIdInputSchema,
  automationOptionsSchema,
  updateAutomationInputSchema,
} from "../model";

export const AUTOMATION_SESSION_INSTRUCTIONS = `This is an automation session: its session ID is also its automation ID. Use the automation tools when the task requires inspecting or changing that automation.

Treat user edits to this run's artifacts as feedback on the automation prompt. When the intent is clear, update the automation accordingly.`;

const listAutomationsTool = defineTool("list_automations", {
  description:
    "Lists all available automations. " +
    "Returns full automation records so they can be inspected, edited, or run.",
  parameters: z.object({}),
  handler: async () => {
    const { listAutomations } = await import("./index");
    const automations = await listAutomations();

    return { automations };
  },
});

const createAutomationTool = defineTool("create_automation", {
  description:
    "Creates a new automation with a title, prompt, cron schedule, model configuration, and optional working directory. " +
    "Returns the created automation record.",
  parameters: automationOptionsSchema,
  handler: async (input) => {
    const { createAutomation } = await import("./index");
    const automation = await createAutomation(input);
    return { automation };
  },
});

const updateAutomationTool = defineTool("update_automation", {
  description:
    "Updates an existing automation by ID. " +
    "Use list_automations first to inspect the current automation and preserve any unchanged values. " +
    "Returns the updated automation record.",
  parameters: updateAutomationInputSchema,
  handler: async ({ automationId, ...input }) => {
    const { updateAutomation } = await import("./index");
    const automation = await updateAutomation(automationId, input);
    return { automation };
  },
});

const runAutomationTool = defineTool("run_automation", {
  description:
    "Runs an automation by ID. " +
    "Use list_automations first if you need to discover the available automation IDs. " +
    "Returns the session ID for the triggered automation run.",
  parameters: automationIdInputSchema,
  handler: async ({ automationId }) => {
    const { runAutomation } = await import("./index");
    return runAutomation(automationId);
  },
});

export const automationTools = [
  listAutomationsTool,
  createAutomationTool,
  updateAutomationTool,
  runAutomationTool,
];

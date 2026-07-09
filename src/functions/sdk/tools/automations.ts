import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  automationIdInputSchema,
  automationOptionsSchema,
  updateAutomationInputSchema,
} from "@/lib/automation/schema";

const listAutomationsTool = defineTool("list_automations", {
  description:
    "Lists all available automations. " +
    "Returns full automation records so they can be inspected, edited, or run.",
  parameters: z.object({}),
  skipPermission: true,
  handler: async () => {
    const { listAutomations } = await import("@/functions/automations");
    const automations = await listAutomations();

    return JSON.stringify({
      automations,
    });
  },
});

const createAutomationTool = defineTool("create_automation", {
  description:
    "Creates a new automation with a title, prompt, cron schedule, model configuration, and optional working directory. " +
    "Returns the created automation record.",
  parameters: automationOptionsSchema,
  skipPermission: true,
  handler: async (input) => {
    const { createAutomation } = await import("@/functions/automations");
    const automation = await createAutomation({ data: input });
    return JSON.stringify({ automation });
  },
});

const updateAutomationTool = defineTool("update_automation", {
  description:
    "Updates an existing automation by ID. " +
    "Use list_automations first to inspect the current automation and preserve any unchanged values. " +
    "Returns the updated automation record.",
  parameters: updateAutomationInputSchema,
  skipPermission: true,
  handler: async ({ automationId, ...input }) => {
    const { updateAutomation } = await import("@/functions/automations");
    const automation = await updateAutomation({ data: { automationId, ...input } });
    if (!automation) {
      throw new Error("Automation not found");
    }

    return JSON.stringify({ automation });
  },
});

const runAutomationTool = defineTool("run_automation", {
  description:
    "Runs an automation by ID. " +
    "Use list_automations first if you need to discover the available automation IDs. " +
    "Returns the session ID for the triggered automation run.",
  parameters: automationIdInputSchema,
  skipPermission: true,
  handler: async ({ automationId }) => {
    const { runAutomation } = await import("@/functions/automations");
    const result = await runAutomation({ data: { automationId } });
    return JSON.stringify({ sessionId: result.sessionId, started: result.started });
  },
});

export const automationTools = [
  listAutomationsTool,
  createAutomationTool,
  updateAutomationTool,
  runAutomationTool,
];

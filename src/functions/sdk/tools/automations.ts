import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import {
  createServerAutomation,
  listServerAutomations,
  runServerAutomation,
  updateServerAutomation,
} from "@/functions/automations";
import { automationFieldsSchema } from "@/lib/automation/schema";

const listAutomations = defineTool("list_automations", {
  description:
    "Lists all available automations. " +
    "Returns full automation records so they can be inspected, edited, or run.",
  parameters: z.object({}),
  skipPermission: true,
  handler: async () => {
    const automations = await listServerAutomations();

    return JSON.stringify({
      automations,
    });
  },
});

const createAutomationTool = defineTool("create_automation", {
  description:
    "Creates a new automation with a title, prompt, cron schedule, model configuration, and optional working directory. " +
    "Returns the created automation record.",
  parameters: automationFieldsSchema,
  skipPermission: true,
  handler: async (input) => {
    const automation = await createServerAutomation({ data: input });
    return JSON.stringify({ automation });
  },
});

const editAutomation = defineTool("edit_automation", {
  description:
    "Edits an existing automation by ID. " +
    "Use list_automations first to inspect the current automation and preserve any unchanged values. " +
    "Returns the updated automation record.",
  parameters: automationFieldsSchema.extend({
    automationId: z.string().trim().min(1).describe("The automation ID to edit"),
  }),
  skipPermission: true,
  handler: async ({ automationId, ...input }) => {
    const automation = await updateServerAutomation({ data: { automationId, ...input } });
    if (!automation) {
      throw new Error("Automation not found");
    }

    return JSON.stringify({ automation });
  },
});

const runAutomation = defineTool("run_automation", {
  description:
    "Runs an automation by ID. " +
    "Use list_automations first if you need to discover the available automation IDs. " +
    "Returns the session ID for the triggered automation run.",
  parameters: z.object({
    automationId: z.string().trim().min(1).describe("The automation ID to run"),
  }),
  skipPermission: true,
  handler: async ({ automationId }) => {
    const result = await runServerAutomation({ data: { automationId } });
    return JSON.stringify({ sessionId: result.sessionId, started: result.started });
  },
});

export const automationTools = [
  listAutomations,
  createAutomationTool,
  editAutomation,
  runAutomation,
];

import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { listServerAutomations, runServerAutomation } from "@/functions/automations";

const listAutomations = defineTool("list_automations", {
  description: "Lists all available automations. " + "Returns each automation's ID and title.",
  parameters: z.object({}),
  skipPermission: true,
  handler: async () => {
    const automations = await listServerAutomations();

    return JSON.stringify({
      automations: automations.map((automation) => ({
        id: automation.id,
        title: automation.title,
      })),
    });
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
    return JSON.stringify({ sessionId: result.sessionId });
  },
});

export const automationTools = [listAutomations, runAutomation];

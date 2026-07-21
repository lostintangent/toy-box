import { defineTool } from "@github/copilot-sdk";
import { settingsUpdateSchema } from "@/lib/workspace/config/settings";

const updateSettingsTool = defineTool("update_settings", {
  description:
    "Updates one or more Toy Box user settings. " +
    "Only supplied fields change; omitted settings are preserved. " +
    "Use a six-digit hexadecimal value such as '#facc15' for accentColor, and an executable path or an empty string for terminalShell. " +
    "Returns the complete authoritative settings value.",
  parameters: settingsUpdateSchema,
  skipPermission: true,
  handler: async (update) => {
    const { updateSettings } = await import("@/functions/workspace");
    const settings = await updateSettings({ data: update });
    return JSON.stringify({ settings });
  },
});

export const settingsTools = [updateSettingsTool];

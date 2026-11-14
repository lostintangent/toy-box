import { defineTool } from "@sessions/server/tools/definition";
import { settingsUpdateSchema } from "@workspace/model/config/settings";

const updateSettingsTool = defineTool("update_settings", {
  description:
    "Updates one or more Toy Box user settings. " +
    "Only supplied fields change. Omitted settings are preserved. " +
    "Use a six-digit hexadecimal value such as '#facc15' for accentColor, and an executable path or an empty string for terminalShell. " +
    "serverName names this server for every client and peer, and an empty string names it after its computer. " +
    "Returns the complete authoritative settings value.",
  parameters: settingsUpdateSchema.omit({ hyperSessionId: true }),
  handler: async (update) => {
    const { updateSettings } = await import("@workspace/server/state");
    const settings = await updateSettings(update);
    return JSON.stringify({ settings });
  },
});

export const settingsTools = [updateSettingsTool];

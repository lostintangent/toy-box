import { z } from "zod";
import { shallow } from "@tanstack/store";
import { hexColorSchema } from "@/shared/utils";
import { areModelConfigurationsEqual, modelConfigurationSchema } from "@providers/model";

export const settingsSchema = z.object({
  accentColor: hexColorSchema,
  defaultModel: modelConfigurationSchema.nullable(),
  defaultSessionView: z.enum(["all", "responses"]),
  terminalShell: z.string(),
  useWorktree: z.boolean(),
  autoFocusArtifacts: z.enum(["always", "sessions", "automations", "never"]),
  disabledProviders: z.array(z.string()),
  pinnedSessionIds: z.array(z.string()),
  hyperSessionId: z.string().nullable(),
  /** This server's name for its clients and linked servers. Empty means the computer's name. */
  serverName: z.string().trim().max(64),
  /** This server's identity, made when it first starts and never written again. */
  serverId: z.string(),
  /** The owner's other servers, by origin in the order they were linked. Only the link verbs
   *  change them, because linking checks that the server answers. */
  serverLinks: z.array(z.string()),
});

export const settingsUpdateSchema = settingsSchema
  .omit({ serverId: true, serverLinks: true })
  .partial();
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  accentColor: "#facc15",
  defaultModel: null,
  defaultSessionView: "all",
  terminalShell: "",
  useWorktree: false,
  autoFocusArtifacts: "automations",
  disabledProviders: ["claude"],
  pinnedSessionIds: [],
  hyperSessionId: null,
  serverName: "",
  serverId: "",
  serverLinks: [],
};

const SETTINGS_KEYS = settingsSchema.keyof().options;

/** Reads a complete settings value while defaulting missing or invalid fields independently. */
export function normalizeSettings(value: unknown): Settings {
  const source = isRecord(value) ? value : {};

  const settings = Object.fromEntries(
    SETTINGS_KEYS.map((key) => {
      const result = settingsSchema.shape[key].safeParse(source[key]);
      return [key, result.success ? result.data : DEFAULT_SETTINGS[key]] as const;
    }),
  ) as Settings;
  settings.pinnedSessionIds = [...new Set(settings.pinnedSessionIds)].sort();
  settings.disabledProviders = [...new Set(settings.disabledProviders)].sort();
  return settings;
}

/** The settings that decide which sessions the catalog lists. */
export const CATALOG_SETTINGS: readonly (keyof Settings)[] = [
  "disabledProviders",
  "pinnedSessionIds",
];

export function areSettingsEqual(left: Settings, right: Settings): boolean {
  return SETTINGS_KEYS.every((key) => isSettingEqual(key, left, right));
}

export function isSettingEqual(key: keyof Settings, left: Settings, right: Settings): boolean {
  if (key === "defaultModel") {
    return areModelConfigurationsEqual(left.defaultModel, right.defaultModel);
  }
  if (key === "pinnedSessionIds" || key === "disabledProviders") {
    return shallow(new Set(left[key]), new Set(right[key]));
  }
  if (key === "serverLinks") return shallow(left.serverLinks, right.serverLinks);
  return Object.is(left[key], right[key]);
}

export function matchesSessionFeatureScope(
  scope: Settings["autoFocusArtifacts"],
  subject: "session" | "automation",
): boolean {
  if (scope === "never") return false;
  if (scope === "always") return true;
  return (
    (scope === "sessions" && subject === "session") ||
    (scope === "automations" && subject === "automation")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

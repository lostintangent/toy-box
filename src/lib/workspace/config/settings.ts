import { z } from "zod";
import { hexColorSchema, isHexColor } from "@/lib/utils";
import { areModelConfigurationsEqual, modelConfigurationSchema } from "@/lib/modelConfiguration";
import type { Settings } from "@/types";

const SESSION_FEATURE_SCOPE_VALUES = ["always", "sessions", "automations", "never"] as const;

export const DEFAULT_SETTINGS: Settings = {
  accentColor: "#facc15",
  defaultModel: null,
  terminalShell: "",
  useWorktree: false,
  autoFocusArtifacts: "automations",
  showExternalSessions: true,
  pinnedSessionIds: [],
};

const SETTINGS_SHAPE = {
  accentColor: hexColorSchema,
  defaultModel: modelConfigurationSchema.nullable(),
  terminalShell: z.string(),
  useWorktree: z.boolean(),
  autoFocusArtifacts: z.enum(SESSION_FEATURE_SCOPE_VALUES),
  showExternalSessions: z.boolean(),
  pinnedSessionIds: z.array(z.string()),
} satisfies { [Key in keyof Settings]: z.ZodType<Settings[Key]> };

const SETTINGS_KEYS = Object.keys(SETTINGS_SHAPE) as (keyof Settings)[];

export const settingsSchema = z.object(SETTINGS_SHAPE);
export const settingsUpdateSchema = settingsSchema.partial();

/** Reads a complete settings value while defaulting missing or invalid fields independently. */
export function normalizeSettings(value: unknown): Settings {
  const source = isRecord(value) ? value : {};

  const settings = Object.fromEntries(
    SETTINGS_KEYS.map((key) => {
      const result = SETTINGS_SHAPE[key].safeParse(source[key]);
      return [key, result.success ? result.data : DEFAULT_SETTINGS[key]] as const;
    }),
  ) as Settings;
  settings.pinnedSessionIds = [...new Set(settings.pinnedSessionIds)].sort();
  return settings;
}

export function areSettingsEqual(left: Settings, right: Settings): boolean {
  return SETTINGS_KEYS.every((key) => {
    if (key === "defaultModel") {
      return areModelConfigurationsEqual(left.defaultModel, right.defaultModel);
    }
    if (key === "pinnedSessionIds") {
      return areStringSetsEqual(left.pinnedSessionIds, right.pinnedSessionIds);
    }
    return Object.is(left[key], right[key]);
  });
}

export function isAccentColor(value: unknown): value is Settings["accentColor"] {
  return isHexColor(value);
}

export function isSessionFeatureScope(value: unknown): value is Settings["autoFocusArtifacts"] {
  return SESSION_FEATURE_SCOPE_VALUES.includes(value as Settings["autoFocusArtifacts"]);
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

function areStringSetsEqual(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && left.every((value) => rightSet.has(value));
}

import { z } from "zod";
import { areModelConfigurationsEqual, modelConfigurationSchema } from "@/lib/modelConfiguration";
import type { AccentColor, SessionFeatureScope, SessionFeatureSubject, Settings } from "@/types";

const SESSION_FEATURE_SCOPE_VALUES = ["always", "sessions", "automations", "never"] as const;
const accentColorSchema = z.templateLiteral(["#", z.string().regex(/^[0-9a-fA-F]{6}$/)]);

export const DEFAULT_SETTINGS: Settings = {
  accentColor: "#facc15",
  defaultModel: null,
  terminalShell: "",
  useWorktree: false,
  autoFocusArtifacts: "automations",
  showExternalSessions: true,
};

const SETTINGS_SHAPE = {
  accentColor: accentColorSchema,
  defaultModel: modelConfigurationSchema.nullable(),
  terminalShell: z.string(),
  useWorktree: z.boolean(),
  autoFocusArtifacts: z.enum(SESSION_FEATURE_SCOPE_VALUES),
  showExternalSessions: z.boolean(),
} satisfies { [Key in keyof Settings]: z.ZodType<Settings[Key]> };

const SETTINGS_KEYS = Object.keys(SETTINGS_SHAPE) as (keyof Settings)[];

export const settingsSchema = z.object(SETTINGS_SHAPE);
export const settingsUpdateSchema = settingsSchema.partial();

/** Reads a complete settings value while defaulting missing or invalid fields independently. */
export function normalizeSettings(value: unknown): Settings {
  const source = isRecord(value) ? value : {};

  return Object.fromEntries(
    SETTINGS_KEYS.map((key) => {
      const result = SETTINGS_SHAPE[key].safeParse(source[key]);
      return [key, result.success ? result.data : DEFAULT_SETTINGS[key]] as const;
    }),
  ) as Settings;
}

export function areSettingsEqual(left: Settings, right: Settings): boolean {
  return (
    areModelConfigurationsEqual(left.defaultModel, right.defaultModel) &&
    SETTINGS_KEYS.every((key) => key === "defaultModel" || Object.is(left[key], right[key]))
  );
}

export function isAccentColor(value: unknown): value is AccentColor {
  return accentColorSchema.safeParse(value).success;
}

export function isSessionFeatureScope(value: unknown): value is SessionFeatureScope {
  return SESSION_FEATURE_SCOPE_VALUES.includes(value as SessionFeatureScope);
}

export function matchesSessionFeatureScope(
  scope: SessionFeatureScope,
  subject: SessionFeatureSubject,
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

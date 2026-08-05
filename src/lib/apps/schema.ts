import { z } from "zod";
import { APP_ICON_NAMES } from "@/lib/apps/icons";
import { appStateDefinitionSchema } from "@/lib/apps/stateSchema";
import { hexColorSchema, type HexColor } from "@/lib/utils";
import { smallJsonSchema } from "@/lib/smallJson";
import type { AppInstance } from "@/types";

export const DEFAULT_APP_COLOR = "#71717a" satisfies HexColor;

export const appDefinitionIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits, and hyphens only.")
  .max(64);

export const BUILT_IN_APP_DEFINITION_PREFIX = "toybox-";

export const ownerAppDefinitionIdSchema = appDefinitionIdSchema.refine(
  (id) => !id.startsWith(BUILT_IN_APP_DEFINITION_PREFIX),
  `The "${BUILT_IN_APP_DEFINITION_PREFIX}" prefix is reserved for built-in apps.`,
);

export const appTitleSchema = z.string().trim().min(1).max(100);

export const appIdInputSchema = z.object({
  appId: z.string().trim().min(1).max(255).describe("Saved app instance ID."),
});

const appIdSchema = appIdInputSchema.shape.appId;

const appShareMimeTypeSchema = z.string().trim().min(1).max(128);

export const shareWithAppInputSchema = z
  .object({
    appId: appIdSchema,
    targetAppId: appIdSchema,
    mimeType: appShareMimeTypeSchema,
    content: smallJsonSchema,
  })
  .strict();

export const consumeAppShareInputSchema = z
  .object({
    appId: appIdSchema,
    shareId: z.string().trim().min(1).max(255),
  })
  .strict();

const appUpdateFields = {
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe("Revision returned by get_app for the state being updated."),
  title: appTitleSchema.optional(),
  color: hexColorSchema.optional(),
  state: smallJsonSchema
    .optional()
    .describe(
      "Complete replacement state satisfying the schema returned by get_app; preserve unchanged fields.",
    ),
};

const hasAppUpdate = ({
  title,
  color,
  state,
}: {
  title?: string;
  color?: HexColor;
  state?: unknown;
}) => title !== undefined || color !== undefined || state !== undefined;

export const createAppInputSchema = z
  .object({
    definitionId: appDefinitionIdSchema.describe("Installed app definition id."),
    title: appTitleSchema.optional().describe("Instance title; defaults to the definition title."),
    color: hexColorSchema
      .optional()
      .describe("Six-digit hex color; defaults to the definition color."),
    state: smallJsonSchema
      .optional()
      .describe("Initial app state replacing and satisfying the definition default."),
  })
  .strict();

export const updateAppInputSchema = appIdInputSchema
  .extend(appUpdateFields)
  .strict()
  .refine(hasAppUpdate, {
    message: "At least one app field must be updated.",
  });

export const appWorkerUpdateInputSchema = z.object(appUpdateFields).strict().refine(hasAppUpdate, {
  message: "At least one app field must be updated.",
});

export type AppUpdate = Omit<z.output<typeof updateAppInputSchema>, "appId">;

export type AppUpdateResult = {
  status: "updated" | "conflict";
  app: AppInstance;
};

export const appDefinitionBundleInputSchema = z.object({
  definitionId: appDefinitionIdSchema,
  revision: z.string().min(1).max(128),
});

export const appDefinitionInputSchema = z
  .object({
    id: ownerAppDefinitionIdSchema.describe(
      "Owner-installed definition folder under ~/.toy-box/apps.",
    ),
  })
  .strict();

export const installAppInputSchema = z
  .object({
    url: z.string().url().max(2_048).describe("Public GitHub Gist URL."),
    id: ownerAppDefinitionIdSchema
      .optional()
      .describe("Installed definition id; defaults to a slug of the app title."),
  })
  .strict();

export const appManifestSchema = z
  .object({
    title: appTitleSchema,
    description: z.string().trim().max(500).optional(),
    icon: z.enum(APP_ICON_NAMES).optional(),
    color: hexColorSchema.default(DEFAULT_APP_COLOR),
    state: appStateDefinitionSchema,
    accepts: z.array(appShareMimeTypeSchema).default([]),
  })
  .strict();

export const appComponentSourceSchema = z
  .string()
  .max(256 * 1024)
  .refine((source) => source.trim().length > 0, "`app.tsx` cannot be empty.");

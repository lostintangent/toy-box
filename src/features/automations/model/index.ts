import { z } from "zod";
import { modelConfigurationSchema } from "@sessions/model/modelConfiguration";
import { validateAutomationCronDefinition } from "./cron";

export * from "./cron";

const AUTOMATION_ID_PREFIX = "toy-box-auto-";
const AUTOMATION_ID_PATTERN =
  /^toy-box-auto-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAutomationId(): string {
  return `${AUTOMATION_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isAutomationId(id: string): boolean {
  return AUTOMATION_ID_PATTERN.test(id);
}

export const automationIdSchema = z
  .string()
  .trim()
  .refine(isAutomationId, "Invalid automation ID")
  .describe("The automation ID");

const nonEmptyTextSchema = z.string().trim().min(1);
const optionalTextSchema = z.string().trim().optional();
const cronDefinitionSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      validateAutomationCronDefinition(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid cron definition",
      });
    }
  });

export const automationOptionsSchema = z.object({
  title: nonEmptyTextSchema,
  prompt: nonEmptyTextSchema,
  model: modelConfigurationSchema.describe("Model and reasoning configuration for automation runs"),
  cron: cronDefinitionSchema,
  cwd: optionalTextSchema,
});

export type AutomationOptions = z.infer<typeof automationOptionsSchema>;

export type Automation = AutomationOptions & {
  id: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  lastRunAt?: string;
};

export const automationIdInputSchema = z.object({
  automationId: automationIdSchema,
});

export const updateAutomationInputSchema = automationOptionsSchema.extend({
  automationId: automationIdSchema,
});

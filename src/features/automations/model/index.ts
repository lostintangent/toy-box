import { z } from "zod";
import { modelConfigurationSchema } from "@providers/model";
import { cronSchema } from "@/shared/cron";

export * from "./cron";

const automationIdSchema = z.string().trim().min(1).describe("The automation ID");

const nonEmptyTextSchema = z.string().trim().min(1);
const optionalTextSchema = z.string().trim().optional();

export const automationOptionsSchema = z.object({
  title: nonEmptyTextSchema,
  prompt: nonEmptyTextSchema,
  model: modelConfigurationSchema.describe("Model and reasoning configuration for automation runs"),
  cron: cronSchema,
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

export const runAutomationInputSchema = automationIdInputSchema.extend({
  clientId: z.string().optional(),
});

export const updateAutomationInputSchema = automationOptionsSchema.extend({
  automationId: automationIdSchema,
});

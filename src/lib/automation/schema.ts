import { z } from "zod";
import { validateAutomationCronDefinition } from "./cron";
import { isAutomationId } from "./id";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

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

export const automationIdInputSchema = z.object({
  automationId: automationIdSchema,
});

export const updateAutomationInputSchema = automationOptionsSchema.extend({
  automationId: automationIdSchema,
});

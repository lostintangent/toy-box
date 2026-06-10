import { z } from "zod";
import { validateAutomationCronDefinition } from "./cron";
import { modelConfigurationSchema } from "@/lib/modelConfiguration";

export const automationIdSchema = z.string().trim().min(1);

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

export const automationFieldsSchema = z.object({
  title: nonEmptyTextSchema,
  prompt: nonEmptyTextSchema,
  modelConfiguration: modelConfigurationSchema.describe("Model configuration for automation runs"),
  cron: cronDefinitionSchema,
  reuseSession: z.boolean().default(false),
  cwd: optionalTextSchema,
});

export const createAutomationInputSchema = automationFieldsSchema;

export const updateAutomationInputSchema = automationFieldsSchema.extend({
  automationId: automationIdSchema,
});

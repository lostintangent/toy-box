import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { validateAutomationCronDefinition } from "@/lib/automation/cron";
import type { Automation } from "@/types";
import { AutomationDatabase } from "./automations/database";
import { emitAutomationsUpdate } from "./automations/events";
import { runAutomation } from "./automations/scheduler";

const automationIdSchema = z.string().trim().min(1);
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

const automationFieldsSchema = z.object({
  title: nonEmptyTextSchema,
  prompt: nonEmptyTextSchema,
  model: nonEmptyTextSchema,
  cron: cronDefinitionSchema,
  reuseSession: z.boolean().default(false),
  cwd: optionalTextSchema,
});

const createAutomationInputSchema = automationFieldsSchema;

const updateAutomationInputSchema = automationFieldsSchema.extend({
  automationId: automationIdSchema,
});

const deleteAutomationInputSchema = z.object({
  automationId: automationIdSchema,
});

const runAutomationInputSchema = z.object({
  automationId: automationIdSchema,
});

let database: AutomationDatabase | undefined;

async function getDatabase(): Promise<AutomationDatabase> {
  if (!database) {
    database = await AutomationDatabase.open();
  }
  return database;
}

export const listServerAutomations = createServerFn({ method: "GET" }).handler(
  async (): Promise<Automation[]> => {
    const db = await getDatabase();
    return await db.list();
  },
);

export const createServerAutomation = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(createAutomationInputSchema))
  .handler(async ({ data }): Promise<Automation> => {
    const db = await getDatabase();
    const automation = await db.create(data);
    emitAutomationsUpdate({
      type: "automation.added",
      automation,
    });
    return automation;
  });

export const updateServerAutomation = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(updateAutomationInputSchema))
  .handler(async ({ data }) => {
    const db = await getDatabase();
    const { automationId, ...options } = data;
    const automation = await db.update(automationId, options);
    if (automation) {
      emitAutomationsUpdate({
        type: "automation.updated",
        automation,
      });
    }

    return {
      success: automation !== null,
    };
  });

export const deleteServerAutomation = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(deleteAutomationInputSchema))
  .handler(async ({ data }) => {
    const db = await getDatabase();
    const success = await db.remove(data.automationId);
    if (success) {
      emitAutomationsUpdate({
        type: "automation.deleted",
        automationId: data.automationId,
      });
    }

    return {
      success,
    };
  });

export const runServerAutomation = createServerFn({ method: "POST" })
  .inputValidator(zodValidator(runAutomationInputSchema))
  .handler(async ({ data }) => {
    return runAutomation(data.automationId);
  });

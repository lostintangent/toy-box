import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  createAutomationInputSchema,
  updateAutomationInputSchema,
  automationIdSchema,
} from "@/lib/automation/schema";
import type { Automation } from "@/types";
import { getAppDatabase } from "./database";
import { AutomationDatabase } from "./automations/database";
import { emitAutomationsUpdate } from "./automations/events";
import { runAutomation } from "./automations/scheduler";

const deleteAutomationInputSchema = z.object({
  automationId: automationIdSchema,
});

const runAutomationInputSchema = z.object({
  automationId: automationIdSchema,
});

let database: AutomationDatabase | undefined;

async function getDatabase(options?: {
  createIfMissing?: boolean;
}): Promise<AutomationDatabase | null> {
  if (!database) {
    const appDatabase = await getAppDatabase(options);
    if (!appDatabase) return null;
    database = new AutomationDatabase(appDatabase);
  }
  return database;
}

export const listServerAutomations = createServerFn({ method: "GET" }).handler(
  async (): Promise<Automation[]> => {
    const db = await getDatabase({ createIfMissing: false });
    if (!db) return [];
    return await db.list();
  },
);

export const createServerAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(createAutomationInputSchema))
  .handler(async ({ data }): Promise<Automation> => {
    const db = await getDatabase();
    if (!db) throw new Error("Failed to open automation database");
    const automation = await db.create(data);
    emitAutomationsUpdate({
      type: "automation.added",
      automation,
    });
    return automation;
  });

export const updateServerAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(updateAutomationInputSchema))
  .handler(async ({ data }): Promise<Automation | null> => {
    const { automationId, ...options } = data;
    const db = await getDatabase();
    if (!db) throw new Error("Failed to open automation database");
    const automation = await db.update(automationId, options);
    if (automation) {
      emitAutomationsUpdate({
        type: "automation.updated",
        automation,
      });
    }

    return automation;
  });

export const deleteServerAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(deleteAutomationInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const db = await getDatabase();
    if (!db) throw new Error("Failed to open automation database");
    const success = await db.remove(data.automationId);
    if (success) {
      emitAutomationsUpdate({
        type: "automation.deleted",
        automationId: data.automationId,
      });
    }

    return success;
  });

export const runServerAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(runAutomationInputSchema))
  .handler(async ({ data }) => {
    return runAutomation(data.automationId);
  });

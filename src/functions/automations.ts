import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  automationIdInputSchema,
  automationOptionsSchema,
  updateAutomationInputSchema,
} from "@/lib/automation/schema";
import type { Automation } from "@/types";
import { getAppDatabase } from "./state/database";
import { deleteSessionIfExists } from "./state/session/registry";
import { AutomationDatabase } from "./automations/database";
import { emitAutomationEvent } from "./runtime/broadcast";
import { startAutomationRun } from "./automations/scheduler";

export const listAutomations = createServerFn({ method: "GET" }).handler(
  async (): Promise<Automation[]> => {
    const database = await getAppDatabase({ createIfMissing: false });
    return database ? new AutomationDatabase(database).list() : [];
  },
);

export const createAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationOptionsSchema))
  .handler(async ({ data }): Promise<Automation> => {
    const automation = await new AutomationDatabase(await getAppDatabase()).create(data);
    emitAutomationEvent({
      type: "automation.added",
      automation,
    });
    return automation;
  });

export const updateAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(updateAutomationInputSchema))
  .handler(async ({ data }): Promise<Automation | null> => {
    const { automationId, ...options } = data;
    const automation = await new AutomationDatabase(await getAppDatabase()).update(
      automationId,
      options,
    );
    if (automation) {
      emitAutomationEvent({
        type: "automation.updated",
        automation,
      });
    }

    return automation;
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationIdInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const database = new AutomationDatabase(await getAppDatabase());
    const automation = await database.get(data.automationId);
    if (!automation) return false;

    await deleteSessionIfExists(automation.id);
    const success = await database.delete(automation.id);
    if (success) {
      emitAutomationEvent({
        type: "automation.deleted",
        automationId: automation.id,
      });
    }

    return success;
  });

export const runAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationIdInputSchema))
  .handler(async ({ data }) => {
    return startAutomationRun(data.automationId);
  });

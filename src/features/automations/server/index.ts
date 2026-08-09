// Automation definition lifecycle behind the validated public operations.

import { broadcast } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import { deleteSessionIfExists } from "@sessions/server/runtime";
import type { Automation, AutomationOptions } from "../model";
import { AutomationDatabase } from "./database";

export async function listAutomations(): Promise<Automation[]> {
  const database = await getStateDatabase({ createIfMissing: false });
  return database ? new AutomationDatabase(database).list() : [];
}

export async function createAutomation(input: AutomationOptions): Promise<Automation> {
  const automation = await new AutomationDatabase(await getStateDatabase()).create(input);
  broadcast({ type: "automation.upserted", automation });
  return automation;
}

export async function updateAutomation(
  automationId: string,
  input: AutomationOptions,
): Promise<Automation | null> {
  const automation = await new AutomationDatabase(await getStateDatabase()).update(
    automationId,
    input,
  );
  if (automation) broadcast({ type: "automation.upserted", automation });
  return automation;
}

export async function deleteAutomation(automationId: string): Promise<boolean> {
  const database = new AutomationDatabase(await getStateDatabase());
  if (!(await database.get(automationId))) return false;

  await deleteSessionIfExists(automationId);
  const deleted = await database.delete(automationId);
  if (deleted) broadcast({ type: "automation.deleted", automationId });
  return deleted;
}

export { startAutomationRun as runAutomation } from "./scheduler";

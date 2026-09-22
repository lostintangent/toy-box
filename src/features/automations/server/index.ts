// Automation definitions and their managed-session lifecycle.

import { broadcast } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import {
  deleteSessionIfExists,
  isSessionRunning,
  recreateSession,
  releaseIdleSession,
} from "@sessions/server/runtime";
import type { SessionCompletion } from "@sessions/model";
import { sharedMap } from "@/shared/server/processState";
import type { Automation, AutomationOptions } from "../model";
import { AutomationDatabase } from "./database";

const pendingAutomationRuns =
  sharedMap<ReturnType<typeof beginAutomationRun>>("pending-automation-runs");

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
): Promise<Automation> {
  const automation = await new AutomationDatabase(await getStateDatabase()).update(
    automationId,
    input,
  );
  if (!automation) throw new Error("Automation not found");
  broadcast({ type: "automation.upserted", automation });
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

export async function runAutomation(automationId: string, clientId?: string) {
  const pending = pendingAutomationRuns.get(automationId);
  if (pending) {
    const { sessionId } = await pending;
    return { sessionId, started: false };
  }

  const run = beginAutomationRun(automationId, clientId);
  pendingAutomationRuns.set(automationId, run);

  try {
    return await run;
  } finally {
    pendingAutomationRuns.delete(automationId);
  }
}

async function beginAutomationRun(automationId: string, clientId?: string) {
  const database = new AutomationDatabase(await getStateDatabase());
  const automation = await database.get(automationId);
  if (!automation) throw new Error("Automation not found");

  if (isSessionRunning(automation.id)) {
    return { sessionId: automation.id, started: false };
  }

  const receipt = await recreateSession(
    automation.id,
    { clientId, content: automation.prompt, model: automation.model },
    { directory: automation.cwd, name: automation.title, sessionType: "automation" },
  );

  void superviseAutomationRun(database, automation.id, receipt.waitForCompletion).catch((error) => {
    console.error(`Failed to finalize automation run ${automation.id}:`, error);
  });
  return { sessionId: automation.id, started: true };
}

async function superviseAutomationRun(
  database: AutomationDatabase,
  automationId: string,
  waitForCompletion: () => Promise<SessionCompletion>,
): Promise<void> {
  try {
    await waitForCompletion();
  } catch (error) {
    console.error(`Failed to await automation run ${automationId}:`, error);
  }

  try {
    const automation = await database.recordRunFinish(automationId, new Date());
    if (automation) broadcast({ type: "automation.upserted", automation });
  } catch (error) {
    console.error(`Failed to persist automation run ${automationId}:`, error);
  }

  await releaseIdleSession(automationId);
}

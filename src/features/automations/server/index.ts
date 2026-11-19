// Automation definitions and their managed-session lifecycle.

import { broadcast } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import {
  deleteSession,
  isSessionRunning,
  recreateSession,
  releaseIdleConnection,
} from "@sessions/server/runtime";
import { sharedMap } from "@/shared/server/processState";
import type { Automation, AutomationOptions } from "../model";
import { AutomationDatabase } from "./database";

const pendingAutomationRuns =
  sharedMap<ReturnType<typeof beginAutomationRun>>("pending-automation-runs");

export async function listAutomations(): Promise<Automation[]> {
  return new AutomationDatabase(await getStateDatabase()).list();
}

export async function getAutomation(automationId: string): Promise<Automation | null> {
  return new AutomationDatabase(await getStateDatabase()).get(automationId);
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

  await deleteSession(automationId);
  const deleted = await database.delete(automationId);
  if (deleted) broadcast({ type: "automation.deleted", automationId });
  return deleted;
}

export async function runAutomation(automationId: string) {
  const pending = pendingAutomationRuns.get(automationId);
  if (pending) {
    const { sessionId } = await pending;
    return { sessionId, started: false };
  }

  const run = beginAutomationRun(automationId);
  pendingAutomationRuns.set(automationId, run);

  try {
    return await run;
  } finally {
    pendingAutomationRuns.delete(automationId);
  }
}

async function beginAutomationRun(automationId: string) {
  const automation = await getAutomation(automationId);
  if (!automation) throw new Error("Automation not found");

  if (isSessionRunning(automation.id)) {
    return { sessionId: automation.id, started: false };
  }

  const receipt = await recreateSession(
    automation.id,
    { content: automation.prompt, model: automation.model },
    { directory: automation.cwd, name: automation.title },
  );

  void receipt
    .waitForCompletion()
    .then(() => releaseIdleConnection(automation.id))
    .catch((error) => {
      console.error(`Failed to release automation run ${automation.id}:`, error);
    });
  return { sessionId: automation.id, started: true };
}

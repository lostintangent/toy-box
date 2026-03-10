import type { QueryClient } from "@tanstack/react-query";
import { automationQueries } from "@/lib/queries";
import type { Automation, AutomationsUpdateEvent } from "@/types";

function sortAutomationsByUpdatedDesc(automations: Automation[]): Automation[] {
  return [...automations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function upsertAutomation(automations: Automation[], automation: Automation): Automation[] {
  const existingIndex = automations.findIndex((item) => item.id === automation.id);
  if (existingIndex === -1) {
    return sortAutomationsByUpdatedDesc([automation, ...automations]);
  }

  const updated = [...automations];
  updated[existingIndex] = automation;
  return sortAutomationsByUpdatedDesc(updated);
}

function removeAutomation(automations: Automation[], automationId: string): Automation[] {
  const index = automations.findIndex((automation) => automation.id === automationId);
  if (index === -1) return automations;

  const nextAutomations = [...automations];
  nextAutomations.splice(index, 1);
  return nextAutomations;
}

function upsertFromEventPayload(
  automations: Automation[],
  event: Extract<
    AutomationsUpdateEvent,
    { type: "automation.added" | "automation.updated" } | { type: "automation.finished" }
  >,
): Automation[] {
  if (event.type === "automation.finished") {
    if (!event.automation) return automations;
    return upsertAutomation(automations, event.automation);
  }

  return upsertAutomation(automations, event.automation);
}

export function applyAutomationsUpdateEvent(
  queryClient: QueryClient,
  event: AutomationsUpdateEvent,
): void {
  queryClient.setQueryData<Automation[]>(automationQueries.all(), (old = []) => {
    switch (event.type) {
      case "automation.added":
      case "automation.updated":
      case "automation.finished":
        return upsertFromEventPayload(old, event);
      case "automation.started":
        return old;
      case "automation.deleted":
        return removeAutomation(old, event.automationId);
    }
  });
}

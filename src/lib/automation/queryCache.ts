import type { QueryClient } from "@tanstack/react-query";
import { automationQueries } from "@/lib/queries";
import type { Automation, AutomationEvent } from "@/types";

export function applyAutomationEvent(queryClient: QueryClient, event: AutomationEvent): void {
  queryClient.setQueryData<Automation[]>(automationQueries.all(), (automations = []) => {
    switch (event.type) {
      case "automation.added":
      case "automation.updated":
        return upsertAutomation(automations, event.automation);
      case "automation.deleted":
        return removeAutomation(automations, event.automationId);
    }
  });
}

function upsertAutomation(automations: Automation[], automation: Automation): Automation[] {
  const index = automations.findIndex((candidate) => candidate.id === automation.id);
  const updated = [...automations];
  if (index === -1) {
    updated.push(automation);
  } else {
    updated[index] = automation;
  }
  return updated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function removeAutomation(automations: Automation[], automationId: string): Automation[] {
  const index = automations.findIndex((automation) => automation.id === automationId);
  if (index === -1) return automations;

  const updated = [...automations];
  updated.splice(index, 1);
  return updated;
}

import type { WorkspaceEvents } from "@workspace/model/events";
import type { Automation } from ".";

/** The catalog's transition function for every client. Automations stay most recently edited
 *  first. */
export function reduceAutomationList(
  list: Automation[],
  event: WorkspaceEvents["automations"],
): Automation[] {
  switch (event.type) {
    case "automation.upserted":
      return [...list.filter(({ id }) => id !== event.automation.id), event.automation].sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
      );
    case "automation.deleted":
      return list.filter(({ id }) => id !== event.automationId);
  }
}

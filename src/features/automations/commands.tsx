import { Pencil, Play, Trash2 } from "lucide-react";
import type { Command } from "@/shared/commands/command";
import { DestructiveConfirmationDialog } from "@/shared/dialogs/DestructiveConfirmationDialog";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { AutomationDialog } from "./components/AutomationDialog";
import type { Automation } from "./model";
import { automationMutations } from "./mutations";

/**
 * What can be done to an automation wherever it's offered: its sidebar menu, or its row in the
 * command palette. Run starts the run without waiting on it, and is disabled while the automation
 * runs, since the server refuses overlap.
 */
export function automationCommands(
  automation: Automation,
  {
    run,
    isRunning,
  }: {
    run: (automationId: string) => void;
    isRunning: boolean;
  },
): Command[] {
  return [
    {
      id: "automation.run",
      title: "Run automation",
      icon: Play,
      disabled: isRunning,
      run: () => run(automation.id),
    },
    {
      id: "automation.edit",
      title: "Edit automation",
      icon: Pencil,
      run: () => openDialog((dialog) => <AutomationDialog {...dialog} automation={automation} />),
    },
    {
      id: "automation.delete",
      title: "Delete automation",
      icon: Trash2,
      destructive: true,
      run: () =>
        openDialog((dialog) => (
          <DestructiveConfirmationDialog
            {...dialog}
            title="Delete automation?"
            description={`This removes ${automation.title}, its schedule, and its session.`}
            mutation={automationMutations.delete(automation.id)}
          />
        )),
    },
  ];
}

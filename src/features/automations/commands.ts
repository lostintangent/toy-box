import { Pencil, Play, Trash2 } from "lucide-react";
import type { Command } from "@/shared/commands/command";
import { openDeleteDialog, openWorkspaceDialog } from "@workspace/hooks/dialogs";
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
    run: (request: { automation: Automation; clientId: string }) => void;
    isRunning: boolean;
  },
): Command[] {
  return [
    {
      id: "automation.run",
      title: "Run automation",
      icon: Play,
      disabled: isRunning,
      run: () => run({ automation, clientId: crypto.randomUUID() }),
    },
    {
      id: "automation.edit",
      title: "Edit automation",
      icon: Pencil,
      run: () => openWorkspaceDialog({ kind: "automation", automation }),
    },
    {
      id: "automation.delete",
      title: "Delete automation",
      icon: Trash2,
      destructive: true,
      run: () =>
        openDeleteDialog({
          title: "Delete automation?",
          description: `This removes ${automation.title}, its schedule, and its session.`,
          mutation: automationMutations.delete(automation.id),
        }),
    },
  ];
}

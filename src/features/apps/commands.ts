import { Pencil, Trash2 } from "lucide-react";
import type { Command } from "@/shared/commands/command";
import { openDeleteDialog, openRenameDialog } from "@workspace/hooks/dialogs";
import type { AppInstance } from "./model";
import { appMutations } from "./mutations";

/**
 * What can be done to a saved app wherever it's offered: its sidebar menu, or its row in the
 * command palette.
 */
export function appCommands(app: AppInstance): Command[] {
  return [
    {
      id: "app.rename",
      title: "Rename app",
      icon: Pencil,
      run: () =>
        openRenameDialog({
          name: app.title,
          title: "Rename app",
          description: "Change how this saved app appears in the Apps list.",
          mutation: appMutations.rename(app),
        }),
    },
    {
      id: "app.delete",
      title: "Delete app",
      icon: Trash2,
      destructive: true,
      run: () =>
        openDeleteDialog({
          title: `Delete ${app.title}?`,
          description:
            "This removes the saved app and its state. Sessions it created remain in Toy Box.",
          mutation: appMutations.delete(app.id),
        }),
    },
  ];
}

import { Pencil, Trash2 } from "lucide-react";
import type { Command } from "@/shared/commands/command";
import { DestructiveConfirmationDialog } from "@/shared/dialogs/DestructiveConfirmationDialog";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { NameDialog } from "@/shared/dialogs/NameDialog";
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
        openDialog((dialog) => (
          <NameDialog
            {...dialog}
            name={app.title}
            title="Rename app"
            description="Change how this saved app appears in the Apps list."
            mutation={appMutations.rename(app)}
          />
        )),
    },
    {
      id: "app.delete",
      title: "Delete app",
      icon: Trash2,
      destructive: true,
      run: () =>
        openDialog((dialog) => (
          <DestructiveConfirmationDialog
            {...dialog}
            title={`Delete ${app.title}?`}
            description="This removes the saved app and its state. Sessions it created remain in Toy Box."
            mutation={appMutations.delete(app.id)}
          />
        )),
    },
  ];
}

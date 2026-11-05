import { createAtom, useSelector } from "@tanstack/react-store";
import type { ComponentProps, ComponentType } from "react";
import type { Automation } from "@automations/model";
import type { Channel } from "@channels/model";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import { NameDialog } from "@/shared/sidebar/NameDialog";

// The workspace's modal dialogs, which any command can open (from a button, menu, shortcut or the
// palette) without threading state to wherever the dialog renders. One shows at a time.

export type WorkspaceDialog =
  | { kind: "settings" }
  | { kind: "files"; directory?: string }
  | { kind: "screens" }
  /** Creates an Automation, or edits the one given. */
  | { kind: "automation"; automation?: Automation }
  /** Creates a Channel, or edits the one given. */
  | { kind: "channel"; channel?: Channel };

// A feature's rename or delete dialog. Only the openers below create one, as a new component each
// time, so every opening starts fresh.
type SubjectDialog = {
  kind: "subject";
  Dialog: ComponentType<{ onOpenChange: (open: boolean) => void }>;
};

const dialogAtom = createAtom<WorkspaceDialog | SubjectDialog | null>(null);

export const openWorkspaceDialog = (dialog: WorkspaceDialog) => dialogAtom.set(dialog);
export const closeWorkspaceDialog = () => dialogAtom.set(null);
export const useWorkspaceDialog = () => useSelector(dialogAtom);

export function openRenameDialog<TData, TContext>(
  dialog: Omit<ComponentProps<typeof NameDialog<TData, TContext>>, "onOpenChange">,
) {
  dialogAtom.set({ kind: "subject", Dialog: (host) => <NameDialog {...dialog} {...host} /> });
}

export function openDeleteDialog<TData, TContext>(
  dialog: Omit<
    ComponentProps<typeof DestructiveConfirmationDialog<TData, TContext>>,
    "onOpenChange"
  >,
) {
  dialogAtom.set({
    kind: "subject",
    Dialog: (host) => <DestructiveConfirmationDialog {...dialog} {...host} />,
  });
}

import { createAtom, useSelector } from "@tanstack/react-store";
import type { ComponentType } from "react";

// Any button, menu, shortcut, or palette row opens a dialog without threading state to wherever it
// renders, and the dialog outlives whatever opened it. One shows at a time. A closed dialog stays
// mounted so it animates out, until the next opening replaces it with a fresh instance. A dialog
// only ever closes its own opening, even when a mutation finishes after it was replaced.

type Dialog = ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>;

const dialogAtom = createAtom<{ Dialog: Dialog; open: boolean; key: number } | null>(null);
let openings = 0;

/** Opens a dialog, given a component (or an inline one passing its props) that takes `open`. */
export function openDialog(Dialog: Dialog) {
  dialogAtom.set({ Dialog, open: true, key: ++openings });
}

/** Renders the dialog last opened, where what it opens can be revealed. */
export function DialogHost() {
  const dialog = useSelector(dialogAtom);
  if (!dialog) return null;
  return (
    <dialog.Dialog
      key={dialog.key}
      open={dialog.open}
      onOpenChange={(open) =>
        dialogAtom.set((current) => (current?.key === dialog.key ? { ...current, open } : current))
      }
    />
  );
}

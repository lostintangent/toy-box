import { FolderOpen, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { OpenFileDialog } from "@files/components/browser/OpenFileDialog";
import type { Command } from "@/shared/commands/command";
import { DestructiveConfirmationDialog } from "@/shared/dialogs/DestructiveConfirmationDialog";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { NameDialog } from "@/shared/dialogs/NameDialog";
import type { Session } from "./model";
import { sessionMutations } from "./mutations";

/**
 * What can be done to a session wherever it's listed (its sidebar menu, or its row in the command
 * palette). Pinning is offered only where the caller can pin it, e.g. not to a child session.
 */
export function sessionCommands(
  session: Session,
  pin?: { isPinned: boolean; toggle: () => void },
): Command[] {
  const isDraft = !session.provider;
  const directory = session.context?.directory;

  return [
    ...(pin
      ? [
          {
            id: "session.pin",
            title: pin.isPinned ? "Unpin session" : "Pin session",
            icon: pin.isPinned ? PinOff : Pin,
            disabled: isDraft,
            run: pin.toggle,
          },
        ]
      : []),
    {
      id: "session.rename",
      title: "Rename session",
      icon: Pencil,
      disabled: isDraft,
      run: () =>
        openDialog((dialog) => (
          <NameDialog
            {...dialog}
            name={session.title ?? ""}
            title="Rename session"
            description="Change how this session appears in the session list."
            mutation={sessionMutations.renameSession(session.id)}
          />
        )),
    },
    ...(directory
      ? [
          {
            id: "session.browseFiles",
            title: "Browse files",
            icon: FolderOpen,
            run: () => openDialog((dialog) => <OpenFileDialog {...dialog} directory={directory} />),
          },
        ]
      : []),
    {
      id: "session.delete",
      title: "Delete session",
      icon: Trash2,
      destructive: true,
      run: () =>
        openDialog((dialog) => (
          <DestructiveConfirmationDialog
            {...dialog}
            title="Delete session?"
            description="This will permanently delete this session, its child sessions, and all their messages. This action cannot be undone."
            mutation={sessionMutations.deleteSession(session.id)}
          />
        )),
    },
  ];
}

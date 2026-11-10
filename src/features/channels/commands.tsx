import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { OpenFileDialog } from "@files/components/browser/OpenFileDialog";
import type { Command } from "@/shared/commands/command";
import { DestructiveConfirmationDialog } from "@/shared/dialogs/DestructiveConfirmationDialog";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { ChannelDialog } from "./components/ChannelDialog";
import type { Channel } from "./model";
import { channelMutations } from "./mutations";

/**
 * What can be done to a Channel wherever it's offered: its sidebar menu, its overview, or its row
 * in the command palette. Browsing files is offered only when it has a working directory.
 */
export function channelCommands(channel: Omit<Channel, "tasks">): Command[] {
  const { directory } = channel;

  return [
    {
      id: "channel.edit",
      title: "Edit channel",
      icon: Pencil,
      run: () => openDialog((dialog) => <ChannelDialog {...dialog} channel={channel} />),
    },
    ...(directory
      ? [
          {
            id: "channel.browseFiles",
            title: "Browse files",
            icon: FolderOpen,
            run: () => openDialog((dialog) => <OpenFileDialog {...dialog} directory={directory} />),
          },
        ]
      : []),
    {
      id: "channel.delete",
      title: "Delete channel",
      icon: Trash2,
      destructive: true,
      run: () =>
        openDialog((dialog) => (
          <DestructiveConfirmationDialog
            {...dialog}
            title={`Delete #${channel.name}?`}
            description="This removes the shared transcript and artifact index, and deletes the lead and each member's private channel session. Files in the working directory are not deleted."
            mutation={channelMutations.delete(channel.id)}
          />
        )),
    },
  ];
}

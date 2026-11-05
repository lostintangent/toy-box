import { AutomationDialog } from "@automations/components/AutomationDialog";
import { ChannelDialog } from "@channels/components/ChannelDialog";
import { createChannelPane } from "@channels/model";
import { FileBrowserDialog } from "@files/components/browser/FileBrowserDialog";
import { createEditorPane } from "@files/model/panes";
import { ScreenBrowserDialog } from "@screens/client/ScreenBrowserDialog";
import { createScreenPane } from "@screens/model";
import type { WorkspacePane } from "../model/panes";
import { closeWorkspaceDialog, useWorkspaceDialog } from "../hooks/dialogs";
import { useWorkspaceSurface } from "../hooks/layout/surface";
import { SettingsDialog } from "./sidebar/SettingsDialog";

/**
 * Renders whichever workspace dialog a command opened. What it opens is revealed in the main
 * surface, and a new Channel replaces the workspace. Deleting needs no pane closed: the route
 * closes any root whose subject left its list.
 */
export function WorkspaceDialogs({ selectRoot }: { selectRoot: (pane: WorkspacePane) => void }) {
  const dialog = useWorkspaceDialog();
  const { reveal } = useWorkspaceSurface();

  return (
    <>
      <SettingsDialog open={dialog?.kind === "settings"} onOpenChange={closeOnDismiss} />
      <FileBrowserDialog
        open={dialog?.kind === "files"}
        onOpenChange={closeOnDismiss}
        initialPath={dialog?.kind === "files" ? dialog.directory : undefined}
        title="Open a file"
        onOpenFile={(file) => reveal(createEditorPane(file))}
      />
      <ScreenBrowserDialog
        open={dialog?.kind === "screens"}
        onOpenChange={closeOnDismiss}
        onOpenScreen={(screenId) => reveal(createScreenPane(screenId))}
      />

      {dialog?.kind === "automation" && (
        <AutomationDialog
          key={dialog.automation?.id}
          automation={dialog.automation}
          onOpenChange={closeOnDismiss}
        />
      )}
      {dialog?.kind === "channel" && (
        <ChannelDialog
          key={dialog.channel?.id}
          channel={dialog.channel}
          onOpenChange={closeOnDismiss}
          onCreated={(channelId) => selectRoot(createChannelPane(channelId))}
        />
      )}
      {dialog?.kind === "subject" && <dialog.Dialog onOpenChange={closeOnDismiss} />}
    </>
  );
}

function closeOnDismiss(open: boolean) {
  if (!open) closeWorkspaceDialog();
}

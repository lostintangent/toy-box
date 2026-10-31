import { AutomationDialog } from "@automations/components/AutomationDialog";
import { ChannelDialog } from "@channels/components/ChannelDialog";
import { createChannelPane } from "@channels/model";
import { FileBrowserDialog } from "@files/components/browser/FileBrowserDialog";
import { createEditorPane } from "@files/model/panes";
import { ScreenBrowserDialog } from "@screens/client/ScreenBrowserDialog";
import { createScreenPane } from "@screens/model";
import { createSessionPane } from "@sessions/model/panes";
import { sessionMutations } from "@sessions/mutations";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import { NameDialog } from "@/shared/sidebar/NameDialog";
import type { WorkspacePane } from "../model/panes";
import { closeWorkspaceDialog, useWorkspaceDialog } from "../hooks/dialogs";
import { SettingsDialog } from "./sidebar/SettingsDialog";

/** Renders whichever workspace dialog a command opened, opening what it chooses as a root pane. */
export function WorkspaceDialogs({
  selectRoot,
  openRoot,
  closeRoot,
}: {
  selectRoot: (pane: WorkspacePane) => void;
  openRoot: (pane: WorkspacePane) => Promise<void>;
  closeRoot: (pane: WorkspacePane) => void;
}) {
  const dialog = useWorkspaceDialog();

  return (
    <>
      <SettingsDialog open={dialog?.kind === "settings"} onOpenChange={closeOnDismiss} />
      <FileBrowserDialog
        open={dialog?.kind === "files"}
        onOpenChange={closeOnDismiss}
        initialPath={dialog?.kind === "files" ? dialog.directory : undefined}
        title="Open a file"
        onOpenFile={(file) => void openRoot(createEditorPane(file))}
      />
      <ScreenBrowserDialog
        open={dialog?.kind === "screens"}
        onOpenChange={closeOnDismiss}
        onOpenScreen={(screenId) => openRoot(createScreenPane(screenId))}
      />

      {dialog?.kind === "automation" && <AutomationDialog onOpenChange={closeOnDismiss} />}
      {dialog?.kind === "channel" && (
        <ChannelDialog
          onOpenChange={closeOnDismiss}
          onCreated={(channelId) => selectRoot(createChannelPane(channelId))}
        />
      )}
      {dialog?.kind === "rename-session" && (
        <NameDialog
          key={dialog.sessionId}
          name={dialog.name}
          title="Rename session"
          description="Change how this session appears in the session list."
          mutation={sessionMutations.renameSession(dialog.sessionId)}
          onOpenChange={closeOnDismiss}
        />
      )}
      {dialog?.kind === "delete-session" && (
        <DestructiveConfirmationDialog
          key={dialog.sessionId}
          title="Delete session?"
          description="This will permanently delete this session, its child sessions, and all their messages. This action cannot be undone."
          mutation={sessionMutations.deleteSession(dialog.sessionId)}
          onSubmit={() => closeRoot(createSessionPane(dialog.sessionId))}
          onOpenChange={closeOnDismiss}
        />
      )}
    </>
  );
}

function closeOnDismiss(open: boolean) {
  if (!open) closeWorkspaceDialog();
}

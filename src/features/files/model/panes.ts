import { createPane, type WorkspacePane } from "@workspace/model/panes";
import { ownerSessionId, workspaceFileId, type WorkspaceFile, type WorkspaceFileMode } from ".";
import { fileName } from "./paths";

declare module "@workspace/model/panes" {
  interface WorkspacePanes {
    /** A live editor for a session artifact or machine file. */
    editor: { file: WorkspaceFile; title: string; mode?: WorkspaceFileMode };
  }
}

export const createEditorPane = (file: WorkspaceFile, mode?: WorkspaceFileMode) =>
  createPane("editor", workspaceFileId(file), {
    sessionId: ownerSessionId(file),
    file,
    title: fileName(file.path),
    mode,
  });

/** The user's pick for this file outranks the mode its publisher asked for, which outranks the
 *  owner's default, so no pane stores derived state. */
export function resolveEditorPaneMode(
  pane: WorkspacePane<"editor">,
  automationSessionIds: readonly string[],
  chosenMode?: WorkspaceFileMode,
): WorkspaceFileMode {
  return (
    chosenMode ??
    pane.mode ??
    (pane.sessionId !== undefined && automationSessionIds.includes(pane.sessionId)
      ? "read"
      : "edit")
  );
}

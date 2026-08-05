import { Loader2 } from "lucide-react";
import type { WorkspaceFileMode } from "@/types";
import type { PaneVariant } from "../../WorkspacePaneView";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../../shell/paneControls";
import { EditorModeMenu } from "./EditorModeMenu";

/** Saving state and mode controls shared by grid and pager hosts. */
export function EditorActions({
  editable,
  mode,
  isSaving,
  onModeChange,
  variant,
}: {
  editable: boolean;
  mode: WorkspaceFileMode;
  isSaving: boolean;
  onModeChange: (mode: WorkspaceFileMode) => void;
  variant: PaneVariant;
}) {
  const isNormal = variant === "normal";
  return (
    <>
      {isSaving && (
        <div
          className="flex items-center justify-center p-1.5"
          role="status"
          aria-label="Saving file"
          title="Saving file"
        >
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {editable && (
        <EditorModeMenu
          mode={mode}
          onModeChange={onModeChange}
          showLabel={!isNormal}
          className={isNormal ? PANE_OVERLAY_BUTTON_CLASS : undefined}
          iconClassName={isNormal ? PANE_OVERLAY_ICON_CLASS : undefined}
        />
      )}
    </>
  );
}

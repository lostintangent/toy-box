import { Loader2 } from "lucide-react";
import type { ArtifactWorkspacePane, ArtifactPaneMode } from "@/lib/workspace/panes";
import type { PaneVariant } from "../../types";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../../paneControls";
import { ArtifactModeMenu } from "./ArtifactModeMenu";

/**
 * An artifact pane's title-bar actions — a saving indicator and the mode menu —
 * shared by the two hosts that render them: the grid's hover overlay ("normal"
 * variant: icon-only, overlay-button styling) and the pager's title bar
 * ("compact" variant: the labeled mode badge). Keeping this one component means
 * the two surfaces can't drift.
 */
export function ArtifactActions({
  pane,
  isSaving,
  onModeChange,
  variant,
}: {
  pane: ArtifactWorkspacePane;
  isSaving: boolean;
  onModeChange?: (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => void;
  variant: PaneVariant;
}) {
  if (!isSaving && !onModeChange) return null;

  const isNormal = variant === "normal";
  return (
    <>
      {isSaving && (
        <div
          className="flex items-center justify-center p-1.5"
          role="status"
          aria-label="Saving artifact"
          title="Saving artifact"
        >
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {onModeChange && (
        <ArtifactModeMenu
          mode={pane.mode}
          onModeChange={(mode) => onModeChange(pane, mode)}
          showLabel={!isNormal}
          className={isNormal ? PANE_OVERLAY_BUTTON_CLASS : undefined}
          iconClassName={isNormal ? PANE_OVERLAY_ICON_CLASS : undefined}
        />
      )}
    </>
  );
}

import { Loader2 } from "lucide-react";
import type { ArtifactPaneMode } from "@/lib/workspace/panes";
import type { PaneVariant } from "../../types";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../../paneControls";
import { ArtifactModeMenu } from "./ArtifactModeMenu";

/** Saving state and mode controls shared by grid and pager hosts. */
export function ArtifactActions({
  mode,
  isSaving,
  onModeChange,
  variant,
}: {
  mode: ArtifactPaneMode;
  isSaving: boolean;
  onModeChange: (mode: ArtifactPaneMode) => void;
  variant: PaneVariant;
}) {
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
      <ArtifactModeMenu
        mode={mode}
        onModeChange={onModeChange}
        showLabel={!isNormal}
        className={isNormal ? PANE_OVERLAY_BUTTON_CLASS : undefined}
        iconClassName={isNormal ? PANE_OVERLAY_ICON_CLASS : undefined}
      />
    </>
  );
}

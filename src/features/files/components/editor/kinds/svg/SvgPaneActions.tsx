import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/utils";
import type { WhiteboardActions } from "@whiteboard/Whiteboard";
import { PaneActions } from "@workspace/components/panes/shell/PaneSlots";
import { PANE_OVERLAY_BUTTON_CLASS } from "@workspace/components/panes/shell/paneControls";
import { Check, ChevronDown, Copy, ImagePlus, Maximize2, Minus, Plus, Trash2 } from "lucide-react";

const COPY_SUCCESS_DURATION_MS = 2_000;

/** Presents Whiteboard commands in the current file pane's action slot. */
export function SvgPaneActions({
  actions,
  compact,
}: {
  actions: WhiteboardActions;
  compact: boolean;
}) {
  const copySuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const zoomPercentage = Math.round(actions.zoom * 100);

  useEffect(() => {
    return () => {
      if (copySuccessTimeoutRef.current) clearTimeout(copySuccessTimeoutRef.current);
    };
  }, []);

  async function copyDocumentAsImage() {
    try {
      if (!(await actions.copyAsImage())) return;
      if (copySuccessTimeoutRef.current) clearTimeout(copySuccessTimeoutRef.current);
      setShowCopySuccess(true);
      copySuccessTimeoutRef.current = setTimeout(
        () => setShowCopySuccess(false),
        COPY_SUCCESS_DURATION_MS,
      );
    } catch (error) {
      console.error("Unable to copy the SVG artifact as an image:", error);
    }
  }

  return (
    <PaneActions>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`SVG zoom: ${zoomPercentage}%`}
              title="SVG zoom"
              className={cn(
                "flex shrink-0 items-center gap-1 text-xs transition-colors",
                compact ? "rounded-md px-2 py-1.5 hover:bg-muted" : PANE_OVERLAY_BUTTON_CLASS,
              )}
            />
          }
        >
          <span>{zoomPercentage}%</span>
          {showCopySuccess ? (
            <Check className="size-3 text-green-500" />
          ) : (
            <ChevronDown className="size-3 opacity-60" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" finalFocus={false}>
          <DropdownMenuItem onClick={actions.zoomIn} disabled={!actions.canZoom}>
            <Plus />
            Zoom in
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.zoomOut} disabled={!actions.canZoom}>
            <Minus />
            Zoom out
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.fitContent} disabled={!actions.canFitContent}>
            <Maximize2 />
            Zoom to fit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={actions.insertImage} disabled={!actions.canInsertImage}>
            <ImagePlus />
            Insert image
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copyDocumentAsImage()}
            disabled={!actions.canCopyAsImage}
          >
            <Copy />
            Copy as image
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={actions.clear} disabled={!actions.canClear}>
            <Trash2 />
            Clear SVG
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PaneActions>
  );
}

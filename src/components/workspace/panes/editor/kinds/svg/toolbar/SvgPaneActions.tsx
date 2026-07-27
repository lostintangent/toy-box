import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreferredColorScheme } from "@/hooks/browser/usePreferredColorScheme";
import { cn } from "@/lib/utils";
import { PaneActions } from "../../../../PaneSlots";
import type { PaneVariant } from "../../../../types";
import { PANE_OVERLAY_BUTTON_CLASS } from "../../../../paneControls";
import { Check, ChevronDown, Copy, ImagePlus, Maximize2, Minus, Plus, Trash2 } from "lucide-react";
import type { SvgDocument } from "../document";
import {
  insertImageFile,
  SVG_RASTER_IMAGE_TYPES,
  writeSvgImageToClipboard,
} from "../editor/images/images";
import type { EditorStore } from "../store";

const COPY_SUCCESS_DURATION_MS = 2_000;

/** Owns the pane-level viewport and document commands for one SVG editor. */
export function SvgPaneActions({
  document,
  store,
  variant,
}: {
  document: SvgDocument;
  store: EditorStore;
  variant: PaneVariant;
}) {
  const copySuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const colorScheme = usePreferredColorScheme();
  const backgroundColor = colorScheme === "dark" ? "#0a0a0a" : "#ffffff";
  const isEmpty = useSyncExternalStore(
    document.subscribe,
    () => document.getSnapshot().isEmpty,
    () => document.getSnapshot().isEmpty,
  );
  const { zoom, readOnly, gestureActive } = useSelector(
    store,
    (state) => ({
      zoom: state.viewport.zoom,
      readOnly: state.readOnly,
      gestureActive: state.gesture !== null,
    }),
    { compare: shallow },
  );
  const zoomPercentage = Math.round(zoom * 100);

  useEffect(() => {
    return () => {
      if (copySuccessTimeoutRef.current) clearTimeout(copySuccessTimeoutRef.current);
    };
  }, []);

  function chooseImage() {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.accept = [...SVG_RASTER_IMAGE_TYPES].join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void insertImageFile(store, file);
    };
    input.click();
  }

  async function copyDocumentAsImage() {
    const serialized = document.serialize();
    if ("error" in serialized) return;
    try {
      await writeSvgImageToClipboard(serialized.content, document.page, backgroundColor);
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
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`SVG zoom: ${zoomPercentage}%`}
            title="SVG zoom"
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs transition-colors",
              variant === "normal"
                ? PANE_OVERLAY_BUTTON_CLASS
                : "rounded-md px-2 py-1.5 hover:bg-muted",
            )}
          >
            <span>{zoomPercentage}%</span>
            {showCopySuccess ? (
              <Check className="size-3 text-green-500" />
            ) : (
              <ChevronDown className="size-3 opacity-60" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuItem onSelect={store.actions.zoomIn} disabled={gestureActive}>
            <Plus />
            Zoom in
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={store.actions.zoomOut} disabled={gestureActive}>
            <Minus />
            Zoom out
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={store.actions.fitContent} disabled={isEmpty || gestureActive}>
            <Maximize2 />
            Zoom to fit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={chooseImage} disabled={readOnly}>
            <ImagePlus />
            Insert image
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyDocumentAsImage()} disabled={isEmpty}>
            <Copy />
            Copy as image
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={store.actions.clear} disabled={readOnly || isEmpty}>
            <Trash2 />
            Clear SVG
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PaneActions>
  );
}

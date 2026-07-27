import { useEffect, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import {
  Braces,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Redo2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PaneActions } from "../../../PaneSlots";
import type { PaneVariant } from "../../../types";
import { PANE_OVERLAY_BUTTON_CLASS } from "../../../paneControls";
import { serializeDocument } from "./document";
import type { JsonEditorStore } from "./store";

const COPY_SUCCESS_DURATION_MS = 2_000;

/** Pane-level whole-document commands for one JSON editor. */
export function JsonPaneActions({
  editor,
  variant,
}: {
  editor: JsonEditorStore;
  variant: PaneVariant;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { canUndo, canRedo } = useSelector(
    editor,
    (state) => ({ canUndo: state.past.length > 0, canRedo: state.future.length > 0 }),
    { compare: shallow },
  );

  useEffect(() => {
    return () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    };
  }, []);

  async function copyDocument(): Promise<void> {
    const root = editor.state.root;
    if (!root) return;
    try {
      await navigator.clipboard.writeText(serializeDocument(root));
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      setCopied(true);
      copyTimeout.current = setTimeout(() => setCopied(false), COPY_SUCCESS_DURATION_MS);
    } catch (error) {
      console.error("Unable to copy JSON to the clipboard:", error);
    }
  }

  return (
    <PaneActions>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="JSON view options"
            title="View options"
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs transition-colors",
              variant === "normal"
                ? PANE_OVERLAY_BUTTON_CLASS
                : "rounded-md px-2 py-1.5 hover:bg-muted",
            )}
          >
            <Braces className="size-3.5" />
            {copied ? (
              <Check className="size-3 text-green-500" />
            ) : (
              <ChevronDown className="size-3 opacity-60" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuItem disabled={!canUndo} onSelect={() => editor.actions.undo()}>
            <Undo2 />
            Undo
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canRedo} onSelect={() => editor.actions.redo()}>
            <Redo2 />
            Redo
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => editor.actions.setCollapsedAll(false)}>
            <ChevronsUpDown />
            Expand all
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.actions.setCollapsedAll(true)}>
            <ChevronsDownUp />
            Collapse all
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyDocument()}>
            <Copy />
            Copy JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PaneActions>
  );
}

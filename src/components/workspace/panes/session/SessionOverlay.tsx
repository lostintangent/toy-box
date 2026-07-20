import { useState } from "react";
import { Loader2, MessageCircle, X } from "lucide-react";
import { Presence as PresencePrimitive } from "radix-ui/internal";
import { useWorkspaceSessionRunning } from "@/hooks/workspace/state";
import { cn } from "@/lib/utils";
import { SessionPane } from "./SessionPane";
import {
  CONTAINER_OVERLAY_BOUNDS,
  SESSION_OVERLAY_BASE_CLASS,
} from "@/components/workspace/overlayWindow";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
} from "@/components/workspace/panes/paneControls";
import { PaneStatus } from "@/components/workspace/panes/PaneSlots";

export function SessionOverlay({ sessionId }: { sessionId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const isSessionRunning = useWorkspaceSessionRunning(sessionId);
  const trigger = (
    <button
      type="button"
      onClick={() => setIsOpen(true)}
      className={cn("order-2", PANE_OVERLAY_BUTTON_CLASS)}
      aria-label="Open session overlay"
      title="Open session overlay"
      aria-hidden={isOpen || undefined}
      tabIndex={isOpen ? -1 : undefined}
    >
      {isSessionRunning ? (
        <Loader2 className={cn(PANE_OVERLAY_ICON_CLASS, "animate-spin")} />
      ) : (
        <MessageCircle className={PANE_OVERLAY_ICON_CLASS} />
      )}
    </button>
  );

  return (
    <>
      {/* The trigger stays mounted underneath the surface (lower z-index) so it
          is revealed the moment the surface fades and collapses on close,
          rather than popping in a frame later. It is inert while covered. */}
      <PaneStatus>{trigger}</PaneStatus>
      {/* Presence keeps the surface mounted while its close animation plays and
          unmounts it on animationend — the data-[state] classes drive the
          enter/exit, so no manual mount/animation bookkeeping is needed here. */}
      <PresencePrimitive.Presence present={isOpen}>
        <div
          data-state={isOpen ? "open" : "closed"}
          className={cn(
            "absolute right-3 bottom-3 z-30",
            SESSION_OVERLAY_BASE_CLASS,
            // Grow out of / collapse back into the trigger button in the
            // bottom-right corner. fill-mode-forwards holds the collapsed end
            // state so it never flashes back to visible before unmounting;
            // pointer-events-none lets the revealed button be clicked mid-close.
            "origin-bottom-right duration-200",
            "data-[state=open]:animate-in data-[state=open]:duration-300 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-90 data-[state=open]:slide-in-from-bottom-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-90 data-[state=closed]:slide-out-to-bottom-2 data-[state=closed]:fill-mode-forwards data-[state=closed]:pointer-events-none",
          )}
          style={CONTAINER_OVERLAY_BOUNDS}
        >
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className={cn("absolute top-3 right-3 z-10", PANE_OVERLAY_BUTTON_CLASS)}
            aria-label="Close session overlay"
            title="Close session overlay"
          >
            <X className={PANE_OVERLAY_ICON_CLASS} />
          </button>
          <SessionPane key={sessionId} sessionId={sessionId} mode="overlay" />
        </div>
      </PresencePrimitive.Presence>
    </>
  );
}

import { useState } from "react";
import { CircleHelp, Loader2, MessageCircle, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { cn } from "@/shared/utils";
import {
  CONTAINER_OVERLAY_BOUNDS,
  SESSION_OVERLAY_BASE_CLASS,
} from "@workspace/components/overlayWindow";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
} from "@workspace/components/panes/shell/paneControls";
import { PaneStatus } from "@workspace/components/panes/shell/PaneSlots";
import { SessionPane } from "./SessionPane";

export function SessionOverlay({ sessionId }: { sessionId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const { running, waiting } = useWorkspaceSessionActivity(sessionId);
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
      {waiting ? (
        <CircleHelp className={PANE_OVERLAY_ICON_CLASS} />
      ) : running ? (
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
      <AnimatePresence initial={false}>
        {isOpen && (
          <m.div
            key="session-overlay"
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.3 } }}
            exit={{
              opacity: 0,
              scale: 0.9,
              y: 8,
              pointerEvents: "none",
              transition: { duration: 0.2 },
            }}
            className={cn(
              "absolute right-3 bottom-3 z-30 origin-bottom-right",
              SESSION_OVERLAY_BASE_CLASS,
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
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

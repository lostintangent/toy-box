import { useEffect, useState } from "react";
import { Loader2, MessageCircle, X } from "lucide-react";
import { Presence as PresencePrimitive } from "radix-ui/internal";
import {
  matchesSessionFeatureScope,
  type SessionFeatureScope,
  type SessionFeatureSubject,
} from "@/lib/config/settings";
import { cn } from "@/lib/utils";
import { SessionPane, type SessionPaneProps } from "./SessionPane";
import {
  CONTAINER_OVERLAY_BOUNDS,
  SESSION_OVERLAY_BASE_CLASS,
} from "@/components/workspace/overlayWindow";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
} from "@/components/workspace/panes/paneControls";

export type SessionOverlayProps = Omit<SessionPaneProps, "mode" | "onBack">;

export function SessionOverlay(props: SessionOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Reset to closed whenever the pane rebinds to a different session.
  useEffect(() => setIsOpen(false), [props.sessionId]);

  return (
    <>
      {/* The trigger stays mounted underneath the surface (lower z-index) so it
          is revealed the moment the surface fades and collapses on close,
          rather than popping in a frame later. It is inert while covered. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn("absolute right-3 bottom-3 z-20", PANE_OVERLAY_BUTTON_CLASS)}
        aria-label="Open session overlay"
        title="Open session overlay"
        aria-hidden={isOpen || undefined}
        tabIndex={isOpen ? -1 : undefined}
      >
        {props.isSessionRunning ? (
          <Loader2 className={cn(PANE_OVERLAY_ICON_CLASS, "animate-spin")} />
        ) : (
          <MessageCircle className={PANE_OVERLAY_ICON_CLASS} />
        )}
      </button>
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
          <SessionPane {...props} mode="overlay" variant="compact" />
        </div>
      </PresencePrimitive.Presence>
    </>
  );
}

type ShouldShowSessionOverlayOptions = {
  visibility: SessionFeatureScope;
  sessionType: SessionFeatureSubject;
  isDesktop: boolean;
  isMaximized: boolean;
  isSessionPane: boolean;
};

export function shouldShowSessionOverlay({
  visibility,
  sessionType,
  isDesktop,
  isMaximized,
  isSessionPane,
}: ShouldShowSessionOverlayOptions): boolean {
  if (!isDesktop || !isMaximized || isSessionPane) return false;
  return matchesSessionFeatureScope(visibility, sessionType);
}

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import {
  matchesSessionFeatureScope,
  type SessionFeatureScope,
  type SessionFeatureSubject,
} from "@/lib/config/settings";
import { cn } from "@/lib/utils";
import { SessionPane, type SessionPaneProps } from "./SessionPane";

export const PANE_OVERLAY_BUTTON_CLASS =
  "bg-background/90 backdrop-blur-sm hover:bg-background border border-border rounded-md p-1.5 shadow-sm hover:shadow-md";

export const PANE_OVERLAY_ICON_CLASS = "h-4 w-4 text-muted-foreground hover:text-foreground";

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

export type SessionOverlayProps = Omit<
  SessionPaneProps,
  "draftSessionId" | "mode" | "onBack" | "onDraftSessionCreated"
>;

export function SessionOverlay(props: SessionOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [props.sessionId]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn("absolute right-3 bottom-3 z-20", PANE_OVERLAY_BUTTON_CLASS)}
        aria-label="Open session overlay"
        title="Open session overlay"
      >
        <MessageCircle className={PANE_OVERLAY_ICON_CLASS} />
      </button>
    );
  }

  return (
    <div className="absolute right-3 bottom-3 z-30 h-[600px] max-h-[calc(100%-1.5rem)] w-[450px] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-md border bg-background shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200">
      <button
        type="button"
        onClick={() => setIsOpen(false)}
        className={cn("absolute top-3 right-3 z-10", PANE_OVERLAY_BUTTON_CLASS)}
        aria-label="Close session overlay"
        title="Close session overlay"
      >
        <X className={PANE_OVERLAY_ICON_CLASS} />
      </button>
      <SessionPane {...props} mode="overlay" />
    </div>
  );
}

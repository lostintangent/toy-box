import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useAtom } from "@tanstack/react-store";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { useFocusedPaneAtom } from "@workspace/hooks/layout/surface";
import { cn } from "@/shared/utils";
import { paneSourceSessionId, type WorkspacePane } from "@workspace/model/panes";
import { WorkspacePaneView } from "../panes/WorkspacePaneView";
import { SessionOverlay } from "@sessions/components/SessionOverlay";

type WorkspacePagerProps = {
  panes: WorkspacePane[];
  primaryPaneId: string;
  onBack?: () => void;
  resolvePaneClose?: (pane: WorkspacePane) => (() => void) | undefined;
  /**
   * When set (the hyper deck), the pager's toolbar — the dots + the active
   * pane's declared actions — is portaled into this element (the window's title
   * bar) instead of rendering inline at the top. `null` means the host is
   * expected but not mounted yet, so no inline fallback should render.
   */
  toolbarSlot?: HTMLElement | null;
};

export function WorkspacePager({
  panes,
  primaryPaneId,
  onBack,
  resolvePaneClose,
  toolbarSlot,
}: WorkspacePagerProps) {
  const [focusedPaneId, setFocusedPaneId] = useAtom(useFocusedPaneAtom());
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const [initialPaneIds] = useState<ReadonlySet<string>>(
    () => new Set(panes.map((pane) => pane.id)),
  );

  // The focused pane is the active page when it's one of ours; otherwise fall
  // back to the primary root pane. Focus clears centrally when its pane departs
  // (see WorkspaceSurfaceProvider), so a fresh selection lands on its own pane.
  const primaryPane = panes.find((pane) => pane.id === primaryPaneId) ?? panes[0];
  const activePane =
    (focusedPaneId === null ? undefined : panes.find((pane) => pane.id === focusedPaneId)) ??
    primaryPane;
  const activePaneId = activePane?.id ?? primaryPaneId;
  const closeActivePane =
    activePane && activePane.id !== primaryPane?.id ? resolvePaneClose?.(activePane) : undefined;

  // The pager's toolbar: an optional mobile back button, the dot strip, and
  // slots the active pane fills with transient status and persistent actions.
  // Interactive groups stop pointer-down so a host title-bar drag (the hyper
  // window) can't start on them.
  function stopDrag(event: ReactPointerEvent) {
    event.stopPropagation();
  }
  const toolbar = (
    <>
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          onPointerDown={stopDrag}
          className="shrink-0 gap-2 md:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sessions
        </Button>
      )}
      {panes.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <PagerDots
            panes={panes}
            activePaneId={activePaneId}
            initialPaneIds={initialPaneIds}
            onDotPress={setFocusedPaneId}
            onPointerDown={stopDrag}
          />
        </div>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1.5" onPointerDown={stopDrag}>
        <div ref={setStatusSlot} className="flex shrink-0 items-center gap-1.5" />
        <div ref={setActionsSlot} className="flex min-w-0 items-center gap-1.5" />
        {closeActivePane && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Close"
            onClick={closeActivePane}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );
  const renderedToolbar =
    toolbarSlot === undefined ? (
      <div className="relative flex min-h-11 shrink-0 items-center gap-2 border-b bg-background px-2">
        {toolbar}
      </div>
    ) : (
      toolbarSlot && createPortal(toolbar, toolbarSlot)
    );

  return (
    <div className="flex h-full flex-col">
      {renderedToolbar}
      <div className="relative min-h-0 flex-1">
        {panes.map((pane) => {
          const isActive = pane.id === activePaneId;
          const associatedSessionId = paneSourceSessionId(pane);
          const hasSourceSessionPane =
            associatedSessionId !== undefined &&
            panes.some(
              (candidate) =>
                candidate.kind === "session" && candidate.sessionId === associatedSessionId,
            );
          const shouldRenderSessionOverlay =
            associatedSessionId !== undefined && pane.kind !== "session" && !hasSourceSessionPane;
          // Stack all panes and toggle visibility (not display) so inactive ones keep their
          // layout — and therefore their scroll position — instead of being torn out and reset.
          return (
            <div
              key={pane.id}
              className={cn("absolute inset-0", !isActive && "invisible pointer-events-none")}
            >
              <WorkspacePaneView
                pane={pane}
                variant="compact"
                isVisible={isActive}
                slots={{
                  actions: isActive ? actionsSlot : null,
                  status: isActive ? statusSlot : null,
                }}
                onFocusPane={setFocusedPaneId}
              >
                {shouldRenderSessionOverlay && <SessionOverlay sessionId={associatedSessionId} />}
              </WorkspacePaneView>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PagerDotsProps {
  panes: WorkspacePane[];
  activePaneId: string;
  initialPaneIds: ReadonlySet<string>;
  onDotPress: (paneId: string) => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
}

function PagerDots({
  panes,
  activePaneId,
  initialPaneIds,
  onDotPress,
  onPointerDown,
}: PagerDotsProps) {
  return (
    <div
      className="pointer-events-auto flex items-center justify-center gap-1 rounded-full bg-muted/60 px-1.5 py-1 md:px-1 md:py-0.5"
      onPointerDown={onPointerDown}
    >
      {panes.map((pane) => (
        <PagerDot
          key={pane.id}
          pane={pane}
          isActive={pane.id === activePaneId}
          animateEntry={!initialPaneIds.has(pane.id)}
          onPress={onDotPress}
        />
      ))}
    </div>
  );
}

interface PagerDotProps {
  pane: WorkspacePane;
  isActive: boolean;
  animateEntry: boolean;
  onPress: (paneId: string) => void;
}

type PagerDotButtonProps = PagerDotProps & {
  isRunning?: boolean;
  isWaiting?: boolean;
  isUnread?: boolean;
};

function PagerDot(props: PagerDotProps) {
  return props.pane.kind === "session" ? (
    <SessionPagerDot {...props} pane={props.pane} />
  ) : (
    <PagerDotButton {...props} />
  );
}

function SessionPagerDot({
  pane,
  ...props
}: Omit<PagerDotProps, "pane"> & {
  pane: Extract<WorkspacePane, { kind: "session" }>;
}) {
  const {
    running: isRunning,
    waiting: isWaiting,
    unread: isUnread,
  } = useWorkspaceSessionActivity(pane.sessionId);

  return (
    <PagerDotButton
      pane={pane}
      {...props}
      isRunning={isRunning}
      isWaiting={isWaiting}
      isUnread={isUnread}
    />
  );
}

function PagerDotButton({
  pane,
  isActive,
  animateEntry,
  onPress,
  isRunning = false,
  isWaiting = false,
  isUnread = false,
}: PagerDotButtonProps) {
  const presentation = getPagerDotPresentation(pane);
  // Visual state priority: active > running > waiting > unread > pane kind
  const dotClass = isActive
    ? "bg-foreground h-3 w-3"
    : cn(
        "h-2.5 w-2.5",
        isRunning
          ? "bg-sky-500 animate-pulse"
          : isWaiting
            ? "bg-amber-500"
            : isUnread
              ? "bg-unread"
              : presentation.colorClassName,
      );

  return (
    <button
      type="button"
      aria-label={presentation.label}
      aria-current={isActive ? "page" : undefined}
      className="flex items-center justify-center h-5 w-5 md:h-4 md:w-4 touch-manipulation"
      onClick={() => onPress(pane.id)}
    >
      <span
        className={cn(
          "rounded-full transition-all duration-200",
          dotClass,
          animateEntry && "animate-in fade-in zoom-in-50 duration-300",
        )}
      />
    </button>
  );
}

function getPagerDotPresentation(pane: WorkspacePane): {
  label: string;
  colorClassName: string;
} {
  switch (pane.kind) {
    case "inbox":
      return { label: "Inbox", colorClassName: "bg-muted-foreground/40" };
    case "app":
      return { label: "App", colorClassName: "bg-amber-500" };
    case "channel":
      return { label: "Channel", colorClassName: "bg-cyan-500" };
    case "session":
      return { label: "Session", colorClassName: "bg-muted-foreground/40" };
    case "canvas":
      return {
        label: `Canvas ${pane.canvas.title || pane.canvas.canvasId}`,
        colorClassName: "bg-violet-500",
      };
    case "editor":
      return { label: pane.title, colorClassName: "bg-emerald-500" };
  }
}

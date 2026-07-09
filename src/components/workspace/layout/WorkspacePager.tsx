import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useAtom, useAtomValue } from "jotai";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sessionRunningAtom, sessionUnreadAtom } from "@/hooks/workspace/atoms";
import { useFocusedPaneAtom } from "@/hooks/workspace/layout/focus";
import { cn } from "@/lib/utils";
import { isArtifactPane, paneSourceSessionId, type WorkspacePane } from "@/lib/workspace/panes";
import { WorkspacePaneView } from "../panes/WorkspacePaneView";
import { SessionOverlay } from "../panes/session/SessionOverlay";

type WorkspacePagerProps = {
  panes: WorkspacePane[];
  primaryPaneId: string;
  onBack?: () => void;
  /**
   * When set (the hyper deck), the pager's toolbar — the dots + the active
   * pane's declared actions — is portaled into this element (the window's title
   * bar) instead of rendering inline at the top. `null` means the host is
   * expected but not mounted yet, so no inline fallback should render.
   */
  toolbarSlot?: HTMLElement | null;
};

export function WorkspacePager({ panes, primaryPaneId, onBack, toolbarSlot }: WorkspacePagerProps) {
  const [focusedPaneId, setFocusedPaneId] = useAtom(useFocusedPaneAtom());
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const paneIds = panes.map((pane) => pane.id);
  const fallbackPaneId = panes[0]?.id ?? primaryPaneId;
  const resolvedPrimaryPaneId = paneIds.includes(primaryPaneId) ? primaryPaneId : fallbackPaneId;

  // The focused pane is the active page when it's one of ours; otherwise fall
  // back to the primary root pane. Focus clears centrally when its pane departs
  // (see useWorkspaceFocus), so a fresh selection lands on its own pane.
  const effectiveActivePaneId =
    focusedPaneId !== null && paneIds.includes(focusedPaneId)
      ? focusedPaneId
      : resolvedPrimaryPaneId;
  const appearingPaneIds = useAppearingPanes(paneIds);

  // The pager's toolbar: an optional mobile back button, the dot strip, and a
  // slot the active pane fills with its own actions. Interactive groups stop
  // pointer-down so a host title-bar drag (the hyper window) can't start on them.
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
            activePaneId={effectiveActivePaneId}
            appearingPaneIds={appearingPaneIds}
            onDotPress={setFocusedPaneId}
            onPointerDown={stopDrag}
          />
        </div>
      )}
      <div
        ref={setActionsSlot}
        className="ml-auto flex min-w-0 items-center gap-1.5"
        onPointerDown={stopDrag}
      />
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
          const isActive = pane.id === effectiveActivePaneId;
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
                actionsSlot={isActive ? actionsSlot : null}
                onFocusPane={setFocusedPaneId}
              />
              {shouldRenderSessionOverlay && <SessionOverlay sessionId={associatedSessionId} />}
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
  appearingPaneIds: ReadonlySet<string>;
  onDotPress: (paneId: string) => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
}

function PagerDots({
  panes,
  activePaneId,
  appearingPaneIds,
  onDotPress,
  onPointerDown,
}: PagerDotsProps) {
  return (
    <div
      className="pointer-events-auto flex items-center justify-center gap-1 rounded-full bg-muted/60 px-1.5 py-1 md:px-1 md:py-0.5"
      role="tablist"
      onPointerDown={onPointerDown}
    >
      {panes.map((pane) => (
        <PagerDot
          key={pane.id}
          pane={pane}
          isActive={pane.id === activePaneId}
          isAppearing={appearingPaneIds.has(pane.id)}
          onPress={onDotPress}
        />
      ))}
    </div>
  );
}

interface PagerDotProps {
  pane: WorkspacePane;
  isActive: boolean;
  isAppearing: boolean;
  onPress: (paneId: string) => void;
}

type PagerDotButtonProps = PagerDotProps & {
  isRunning?: boolean;
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
  const isRunning = useAtomValue(sessionRunningAtom(pane.sessionId));
  const isUnread = useAtomValue(sessionUnreadAtom(pane.sessionId));

  return <PagerDotButton pane={pane} {...props} isRunning={isRunning} isUnread={isUnread} />;
}

function PagerDotButton({
  pane,
  isActive,
  isAppearing,
  onPress,
  isRunning = false,
  isUnread = false,
}: PagerDotButtonProps) {
  // Visual state priority: active > streaming > unread > pane kind
  const dotClass = isActive
    ? "bg-foreground h-3 w-3"
    : isRunning
      ? "bg-sky-500 h-2.5 w-2.5 animate-pulse"
      : isUnread
        ? "bg-unread h-2.5 w-2.5"
        : pane.kind === "canvas"
          ? "bg-violet-500 h-2.5 w-2.5"
          : pane.kind === "artifact"
            ? "bg-emerald-500 h-2.5 w-2.5"
            : "bg-muted-foreground/40 h-2.5 w-2.5";
  const label =
    pane.kind === "inbox"
      ? "Inbox"
      : pane.kind === "canvas"
        ? `Canvas ${pane.canvas.title || pane.canvas.canvasId}`
        : isArtifactPane(pane)
          ? pane.title
          : "Session";

  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-label={`${label} ${isActive ? "(active)" : ""}`}
      className="flex items-center justify-center h-5 w-5 md:h-4 md:w-4 touch-manipulation"
      onClick={() => onPress(pane.id)}
    >
      <span
        className={cn(
          "rounded-full transition-all duration-200",
          dotClass,
          isAppearing && "animate-in fade-in zoom-in-50 duration-300",
        )}
      />
    </button>
  );
}

/**
 * Tracks which panes appeared after the initial render. Returns pane IDs that
 * auto-clear after the dot entry animation window.
 */
function useAppearingPanes(ids: string[]): ReadonlySet<string> {
  const knownIdsRef = useRef<Set<string> | null>(null);
  const [appearingIds, setAppearingIds] = useState<ReadonlySet<string>>(() => new Set());

  // Seed on first render — these are not "new"
  if (knownIdsRef.current === null) {
    knownIdsRef.current = new Set(ids);
  }

  useEffect(() => {
    const known = knownIdsRef.current!;
    const justAppearedIds = ids.filter((id) => !known.has(id));

    for (const id of ids) {
      known.add(id);
    }

    if (justAppearedIds.length === 0) return;

    setAppearingIds(new Set(justAppearedIds));
    const timer = setTimeout(() => setAppearingIds(new Set()), 300);
    return () => clearTimeout(timer);
  }, [ids]);

  return appearingIds;
}

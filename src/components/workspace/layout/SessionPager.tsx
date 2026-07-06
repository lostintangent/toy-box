import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceContext } from "@/hooks/workspace/context";
import { cn } from "@/lib/utils";
import {
  createSessionPane,
  isArtifactPane,
  paneSourceSessionId,
  type ArtifactWorkspacePane,
  type ArtifactPaneMode,
  type WorkspacePane,
} from "@/lib/workspace/panes";
import { WorkspacePaneView } from "../panes/WorkspacePaneView";
import type { SessionPaneProps } from "../panes/session/SessionPane";

type SessionPagerProps = Omit<SessionPaneProps, "sessionId"> & {
  panes: WorkspacePane[];
  selectedSessionId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onBack?: () => void;
  onSetArtifactPaneMode?: (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => void;
  /**
   * When set (the hyper deck), the pager's toolbar — the dots + the active
   * pane's declared actions — is portaled into this element (the window's title
   * bar) instead of rendering inline at the top. `null` means the host is
   * expected but not mounted yet, so no inline fallback should render.
   */
  toolbarSlot?: HTMLElement | null;
};

export function SessionPager({
  panes,
  selectedSessionId,
  streamingSessionIds,
  unreadSessionIds,
  onBack,
  onSetArtifactPaneMode,
  toolbarSlot,
  ...sessionViewProps
}: SessionPagerProps) {
  const { focusedPaneAtom } = useWorkspaceContext();
  const [focusedPaneId, setFocusedPaneId] = useAtom(focusedPaneAtom);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const selectedSessionPane = useMemo(
    () => createSessionPane(selectedSessionId, false),
    [selectedSessionId],
  );
  const visiblePanes = useMemo(
    () => (panes.length > 0 ? panes : [selectedSessionPane]),
    [panes, selectedSessionPane],
  );
  const paneIds = useMemo(() => visiblePanes.map((pane) => pane.id), [visiblePanes]);
  const selectedPaneId =
    visiblePanes.find((pane) => pane.kind === "session" && pane.sessionId === selectedSessionId)
      ?.id ?? visiblePanes[0].id;

  // The focused pane is the active page when it's one of ours; otherwise fall
  // back to the selected session's pane. Focus clears centrally when its pane
  // departs (see useWorkspaceFocus), so a fresh selection lands on its own pane.
  const effectiveActivePaneId =
    focusedPaneId !== null && paneIds.includes(focusedPaneId) ? focusedPaneId : selectedPaneId;
  const appearingPaneIds = useAppearingPanes(paneIds);

  const handleDotPress = useCallback(
    (paneId: string) => {
      setFocusedPaneId(paneId);
    },
    [setFocusedPaneId],
  );

  // The pager's toolbar: an optional mobile back button, the dot strip, and a
  // slot the active pane fills with its own actions. Interactive groups stop
  // pointer-down so a host title-bar drag (the hyper window) can't start on them.
  const stopDrag = useCallback((event: ReactPointerEvent) => event.stopPropagation(), []);
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
      {visiblePanes.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <PagerDots
            panes={visiblePanes}
            activePaneId={effectiveActivePaneId}
            streamingSessionIds={streamingSessionIds}
            unreadSessionIds={unreadSessionIds}
            appearingPaneIds={appearingPaneIds}
            onDotPress={handleDotPress}
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
        {visiblePanes.map((pane) => {
          const isActive = pane.id === effectiveActivePaneId;
          const sourceId = paneSourceSessionId(pane);
          // Stack all panes and toggle visibility (not display) so inactive ones keep their
          // layout — and therefore their scroll position — instead of being torn out and reset.
          return (
            <div
              key={pane.id}
              className={cn("absolute inset-0", !isActive && "invisible pointer-events-none")}
            >
              <WorkspacePaneView
                pane={pane}
                {...sessionViewProps}
                isSessionRunning={streamingSessionIds.includes(sourceId)}
                isSessionUnread={unreadSessionIds.includes(sourceId)}
                variant="compact"
                actionsSlot={isActive ? actionsSlot : null}
                onSetArtifactPaneMode={onSetArtifactPaneMode}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dot strip ───────────────────────────────────────────────────────────────

interface PagerDotsProps {
  panes: WorkspacePane[];
  activePaneId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  appearingPaneIds: ReadonlySet<string>;
  onDotPress: (paneId: string) => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
}

const PagerDots = memo(function PagerDots({
  panes,
  activePaneId,
  streamingSessionIds,
  unreadSessionIds,
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
          isStreaming={pane.kind === "session" && streamingSessionIds.includes(pane.sessionId)}
          isUnread={pane.kind === "session" && unreadSessionIds.includes(pane.sessionId)}
          isAppearing={appearingPaneIds.has(pane.id)}
          onPress={onDotPress}
        />
      ))}
    </div>
  );
});

// ── Individual dot ──────────────────────────────────────────────────────────

interface PagerDotProps {
  pane: WorkspacePane;
  isActive: boolean;
  isStreaming: boolean;
  isUnread: boolean;
  isAppearing: boolean;
  onPress: (paneId: string) => void;
}

const PagerDot = memo(function PagerDot({
  pane,
  isActive,
  isStreaming,
  isUnread,
  isAppearing,
  onPress,
}: PagerDotProps) {
  const handlePress = useCallback(() => {
    onPress(pane.id);
  }, [onPress, pane.id]);

  // Visual state priority: active > streaming > unread > pane kind
  const dotClass = isActive
    ? "bg-foreground h-3 w-3"
    : isStreaming
      ? "bg-sky-500 h-2.5 w-2.5 animate-pulse"
      : isUnread
        ? "bg-unread h-2.5 w-2.5"
        : pane.kind === "canvas"
          ? "bg-violet-500 h-2.5 w-2.5"
          : pane.kind === "artifact"
            ? "bg-emerald-500 h-2.5 w-2.5"
            : "bg-muted-foreground/40 h-2.5 w-2.5";
  const label =
    pane.kind === "canvas"
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
      onClick={handlePress}
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
});

// ── Entry animation hook ────────────────────────────────────────────────────

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

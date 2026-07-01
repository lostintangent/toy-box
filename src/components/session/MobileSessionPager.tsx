import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom } from "jotai";
import { focusedPaneAtom } from "@/atoms";
import { cn } from "@/lib/utils";
import {
  createSessionPane,
  isArtifactPane,
  type ArtifactGridPane,
  type ArtifactPaneMode,
  type SessionGridPane,
} from "@/hooks/session/sessionPanes";
import { CanvasPane } from "./panes/CanvasPane";
import { ArtifactPane } from "./panes/ArtifactPane";
import { ARTIFACT_KINDS } from "./panes/artifacts/kinds";
import { SessionPane, type SessionPaneProps } from "./panes/session/SessionPane";

type MobileSessionPagerProps = Omit<SessionPaneProps, "sessionId"> & {
  panes: SessionGridPane[];
  selectedSessionId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onBack: () => void;
  onSetArtifactPaneMode?: (pane: ArtifactGridPane, mode: ArtifactPaneMode) => void;
};

export function MobileSessionPager({
  panes,
  selectedSessionId,
  streamingSessionIds,
  unreadSessionIds,
  onBack,
  onSetArtifactPaneMode,
  ...sessionViewProps
}: MobileSessionPagerProps) {
  const [focusedPaneId, setFocusedPaneId] = useAtom(focusedPaneAtom);
  const fallbackPane = useMemo(
    () => createSessionPane(selectedSessionId, false),
    [selectedSessionId],
  );
  const visiblePanes = useMemo(
    () => (panes.length > 0 ? panes : [fallbackPane]),
    [fallbackPane, panes],
  );
  const selectedPaneId =
    visiblePanes.find((pane) => pane.kind === "session" && pane.sessionId === selectedSessionId)
      ?.id ?? visiblePanes[0].id;
  const paneIds = useMemo(() => visiblePanes.map((pane) => pane.id), [visiblePanes]);
  const newPaneIds = useNewEntries(paneIds);

  // The focused pane is the active page when it's one of ours; otherwise fall
  // back to the selected session's pane. Focus clears centrally when its pane
  // departs (see usePaneFocus), so a fresh selection lands on its own pane.
  const effectiveActivePaneId =
    focusedPaneId !== null && paneIds.includes(focusedPaneId) ? focusedPaneId : selectedPaneId;

  const handleDotPress = useCallback(
    (paneId: string) => {
      setFocusedPaneId(paneId);
    },
    [setFocusedPaneId],
  );

  return (
    <div className="relative h-full">
      {visiblePanes.map((pane) => {
        const isActive = pane.id === effectiveActivePaneId;
        // Stack all panes and toggle visibility (not display) so inactive ones keep their
        // layout — and therefore their scroll position — instead of being torn out and reset.
        return (
          <div
            key={pane.id}
            className={cn("absolute inset-0", !isActive && "invisible pointer-events-none")}
          >
            {pane.kind === "session" ? (
              <SessionPane
                sessionId={pane.sessionId}
                isSessionRunning={streamingSessionIds.includes(pane.sessionId)}
                isSessionUnread={unreadSessionIds.includes(pane.sessionId)}
                onBack={onBack}
                {...sessionViewProps}
              />
            ) : pane.kind === "canvas" ? (
              <CanvasPane pane={pane} onBack={onBack} />
            ) : (
              <ArtifactPane pane={pane} onBack={onBack} onModeChange={onSetArtifactPaneMode} />
            )}
          </div>
        );
      })}
      {visiblePanes.length > 1 && (
        <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 flex h-8 items-center justify-center md:hidden">
          <div className="pointer-events-auto">
            <PagerDots
              panes={visiblePanes}
              activePaneId={effectiveActivePaneId}
              streamingSessionIds={streamingSessionIds}
              unreadSessionIds={unreadSessionIds}
              newPaneIds={newPaneIds}
              onDotPress={handleDotPress}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dot strip ───────────────────────────────────────────────────────────────

interface PagerDotsProps {
  panes: SessionGridPane[];
  activePaneId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  newPaneIds: ReadonlySet<string>;
  onDotPress: (paneId: string) => void;
}

const PagerDots = memo(function PagerDots({
  panes,
  activePaneId,
  streamingSessionIds,
  unreadSessionIds,
  newPaneIds,
  onDotPress,
}: PagerDotsProps) {
  return (
    <div
      className="flex items-center justify-center gap-1 rounded-full bg-muted/60 px-1.5 py-1"
      role="tablist"
    >
      {panes.map((pane) => (
        <PagerDot
          key={pane.id}
          pane={pane}
          isActive={pane.id === activePaneId}
          isStreaming={pane.kind === "session" && streamingSessionIds.includes(pane.sessionId)}
          isUnread={pane.kind === "session" && unreadSessionIds.includes(pane.sessionId)}
          isNew={newPaneIds.has(pane.id)}
          onPress={onDotPress}
        />
      ))}
    </div>
  );
});

// ── Individual dot ──────────────────────────────────────────────────────────

interface PagerDotProps {
  pane: SessionGridPane;
  isActive: boolean;
  isStreaming: boolean;
  isUnread: boolean;
  isNew: boolean;
  onPress: (paneId: string) => void;
}

const PagerDot = memo(function PagerDot({
  pane,
  isActive,
  isStreaming,
  isUnread,
  isNew,
  onPress,
}: PagerDotProps) {
  const handlePress = useCallback(() => {
    onPress(pane.id);
  }, [onPress, pane.id]);

  // Visual state priority: active > streaming > unread > idle
  const artifactDot = isArtifactPane(pane) ? ARTIFACT_KINDS[pane.kind].dotClass : undefined;
  const dotClass = isActive
    ? "bg-foreground h-3 w-3"
    : isStreaming
      ? "bg-sky-500 h-2.5 w-2.5 animate-pulse"
      : isUnread
        ? "bg-blue-500 h-2.5 w-2.5"
        : pane.kind === "canvas"
          ? "bg-violet-500 h-2.5 w-2.5"
          : artifactDot
            ? `${artifactDot} h-2.5 w-2.5`
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
      className="flex items-center justify-center h-5 w-5 touch-manipulation"
      onClick={handlePress}
    >
      <span
        className={cn(
          "rounded-full transition-all duration-200",
          dotClass,
          isNew && "animate-in fade-in zoom-in-50 duration-300",
        )}
      />
    </button>
  );
});

// ── Entry animation hook ────────────────────────────────────────────────────

/**
 * Tracks which IDs in a list are "new" (appeared after the initial render).
 * Returns a set of new IDs that auto-clears after a short animation window.
 */
function useNewEntries(ids: string[]): ReadonlySet<string> {
  const knownIdsRef = useRef<Set<string> | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());

  // Seed on first render — these are not "new"
  if (knownIdsRef.current === null) {
    knownIdsRef.current = new Set(ids);
  }

  useEffect(() => {
    const known = knownIdsRef.current!;
    const justAppeared = ids.filter((id) => !known.has(id));

    for (const id of ids) {
      known.add(id);
    }

    if (justAppeared.length === 0) return;

    setNewIds(new Set(justAppeared));
    const timer = setTimeout(() => setNewIds(new Set()), 300);
    return () => clearTimeout(timer);
  }, [ids]);

  return newIds;
}

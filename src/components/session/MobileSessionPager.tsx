import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SessionGridPane } from "@/hooks/session/sessionPanes";
import { CanvasPane } from "./CanvasPane";
import { SessionView, type SessionViewProps } from "./SessionView";

type MobileSessionPagerProps = Omit<SessionViewProps, "sessionId"> & {
  panes: SessionGridPane[];
  selectedSessionId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onBack: () => void;
};

export function MobileSessionPager({
  panes,
  selectedSessionId,
  streamingSessionIds,
  unreadSessionIds,
  onBack,
  ...sessionViewProps
}: MobileSessionPagerProps) {
  const fallbackPane = createFallbackSessionPane(selectedSessionId);
  const visiblePanes = panes.length > 0 ? panes : [fallbackPane];
  const selectedPaneId =
    visiblePanes.find((pane) => pane.kind === "session" && pane.sessionId === selectedSessionId)
      ?.id ?? visiblePanes[0].id;
  const paneIds = visiblePanes.map((pane) => pane.id);
  const [activePaneId, setActivePaneId] = useState(selectedPaneId);
  const newPaneIds = useNewEntries(paneIds);

  // If the active pane disappears from the list, fall back to selected.
  // If the selected session changes (user picked a new one from sidebar), follow it.
  const activeIsValid = paneIds.includes(activePaneId);
  const effectiveActivePaneId = activeIsValid ? activePaneId : selectedPaneId;

  // Reset when user explicitly selects a different session from the sidebar
  const prevSelectedRef = useRef(selectedSessionId);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedSessionId) {
      prevSelectedRef.current = selectedSessionId;
      setActivePaneId(selectedPaneId);
    }
  }, [selectedPaneId, selectedSessionId]);

  const handleDotPress = useCallback((paneId: string) => {
    setActivePaneId(paneId);
  }, []);

  return (
    <div className="relative h-full">
      {visiblePanes.map((pane) => {
        const isActive = pane.id === effectiveActivePaneId;
        return (
          <div key={pane.id} className={isActive ? "h-full" : "h-full hidden"}>
            {pane.kind === "session" ? (
              <SessionView
                sessionId={pane.sessionId}
                isSessionRunning={streamingSessionIds.includes(pane.sessionId)}
                isSessionUnread={unreadSessionIds.includes(pane.sessionId)}
                onBack={onBack}
                {...sessionViewProps}
              />
            ) : (
              <CanvasPane pane={pane} onBack={onBack} />
            )}
          </div>
        );
      })}
      {visiblePanes.length > 1 && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center h-8 pointer-events-none z-10 md:hidden">
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
  const dotClass = isActive
    ? "bg-foreground h-3 w-3"
    : isStreaming
      ? "bg-sky-500 h-2.5 w-2.5 animate-pulse"
      : isUnread
        ? "bg-blue-500 h-2.5 w-2.5"
        : pane.kind === "canvas"
          ? "bg-violet-500 h-2.5 w-2.5"
          : "bg-muted-foreground/40 h-2.5 w-2.5";
  const label =
    pane.kind === "canvas" ? `Canvas ${pane.canvas.title || pane.canvas.canvasId}` : "Session";

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

function createFallbackSessionPane(
  sessionId: string,
): Extract<SessionGridPane, { kind: "session" }> {
  return {
    kind: "session",
    id: `session:${sessionId}`,
    sessionId,
    isLinkedOnly: false,
  };
}

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

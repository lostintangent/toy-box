import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SessionView, type SessionViewProps } from "./SessionView";

type MobileSessionPagerProps = Omit<SessionViewProps, "sessionId"> & {
  sessionIds: string[];
  selectedSessionId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onBack: () => void;
};

export function MobileSessionPager({
  sessionIds,
  selectedSessionId,
  streamingSessionIds,
  unreadSessionIds,
  onBack,
  ...sessionViewProps
}: MobileSessionPagerProps) {
  const [activeSessionId, setActiveSessionId] = useState(selectedSessionId);
  const newSessionIds = useNewEntries(sessionIds);

  // If the active session disappears from the list, fall back to selected.
  // If the selected session changes (user picked a new one from sidebar), follow it.
  const activeIsValid = sessionIds.includes(activeSessionId);
  const effectiveActiveSessionId = activeIsValid ? activeSessionId : selectedSessionId;

  // Reset when user explicitly selects a different session from the sidebar
  const prevSelectedRef = useRef(selectedSessionId);
  useEffect(() => {
    if (prevSelectedRef.current !== selectedSessionId) {
      prevSelectedRef.current = selectedSessionId;
      setActiveSessionId(selectedSessionId);
    }
  }, [selectedSessionId]);

  const handleDotPress = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  return (
    <div className="relative h-full">
      {(sessionIds.length > 0 ? sessionIds : [selectedSessionId]).map((sessionId) => {
        const isActive = sessionId === effectiveActiveSessionId;
        return (
          <div key={sessionId} className={isActive ? "h-full" : "h-full hidden"}>
            <SessionView
              sessionId={sessionId}
              isSessionRunning={streamingSessionIds.includes(sessionId)}
              isSessionUnread={unreadSessionIds.includes(sessionId)}
              onBack={onBack}
              {...sessionViewProps}
            />
          </div>
        );
      })}
      {sessionIds.length > 1 && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center h-8 pointer-events-none z-10 md:hidden">
          <div className="pointer-events-auto">
            <PagerDots
              sessionIds={sessionIds}
              activeSessionId={effectiveActiveSessionId}
              streamingSessionIds={streamingSessionIds}
              unreadSessionIds={unreadSessionIds}
              newSessionIds={newSessionIds}
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
  sessionIds: string[];
  activeSessionId: string;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  newSessionIds: ReadonlySet<string>;
  onDotPress: (sessionId: string) => void;
}

const PagerDots = memo(function PagerDots({
  sessionIds,
  activeSessionId,
  streamingSessionIds,
  unreadSessionIds,
  newSessionIds,
  onDotPress,
}: PagerDotsProps) {
  return (
    <div
      className="flex items-center justify-center gap-1 rounded-full bg-muted/60 px-1.5 py-1"
      role="tablist"
    >
      {sessionIds.map((sessionId) => (
        <PagerDot
          key={sessionId}
          sessionId={sessionId}
          isActive={sessionId === activeSessionId}
          isStreaming={streamingSessionIds.includes(sessionId)}
          isUnread={unreadSessionIds.includes(sessionId)}
          isNew={newSessionIds.has(sessionId)}
          onPress={onDotPress}
        />
      ))}
    </div>
  );
});

// ── Individual dot ──────────────────────────────────────────────────────────

interface PagerDotProps {
  sessionId: string;
  isActive: boolean;
  isStreaming: boolean;
  isUnread: boolean;
  isNew: boolean;
  onPress: (sessionId: string) => void;
}

const PagerDot = memo(function PagerDot({
  sessionId,
  isActive,
  isStreaming,
  isUnread,
  isNew,
  onPress,
}: PagerDotProps) {
  const handlePress = useCallback(() => {
    onPress(sessionId);
  }, [onPress, sessionId]);

  // Visual state priority: active > streaming > unread > idle
  const dotClass = isActive
    ? "bg-foreground h-3 w-3"
    : isStreaming
      ? "bg-sky-500 h-2.5 w-2.5 animate-pulse"
      : isUnread
        ? "bg-blue-500 h-2.5 w-2.5"
        : "bg-muted-foreground/40 h-2.5 w-2.5";

  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-label={`Session ${isActive ? "(active)" : ""}`}
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

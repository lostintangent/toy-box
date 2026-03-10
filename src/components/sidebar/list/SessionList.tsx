import { useMemo } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionListItem } from "./SessionListItem";
import { buildSessionListEntries, type SessionListEntry } from "./sessionGrouping";
import { cn } from "@/lib/utils";
import type { SessionMetadata } from "@/types";

// ============================================================================
// Session List Skeleton
// ============================================================================

function SessionListSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 8 }, (_, i) => (
        // eslint-disable-next-line react/no-array-index-key -- static skeleton items
        <li
          key={i}
          className="flex items-center justify-between px-2 py-2 rounded-lg border border-transparent"
        >
          <div className="flex-1 min-w-0 mr-2 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </li>
      ))}
    </ul>
  );
}

// ============================================================================
// Session List Component
// ============================================================================

export interface SessionListProps {
  sessions: SessionMetadata[];
  isLoading: boolean;
  onSessionSelect: (sessionId: string | null, modifierKey?: boolean) => void;
  onSessionDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  activeSessionIds?: string[] | null;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  emptyMessage?: string;
  draftSession?: SessionMetadata | null;
}

export function SessionList({
  sessions,
  isLoading,
  onSessionSelect,
  onSessionDelete,
  deletingSessionId,
  activeSessionIds,
  streamingSessionIds,
  unreadSessionIds,
  emptyMessage,
  draftSession,
}: SessionListProps) {
  const hydrated = useHydrated();
  const hasDraft = !!draftSession;

  // Filter out draft from sessions list if it somehow got included
  const filteredSessions = draftSession
    ? sessions.filter((s) => s.sessionId !== draftSession.sessionId)
    : sessions;
  const listEntries = useMemo<SessionListEntry[]>(
    () =>
      hydrated
        ? buildSessionListEntries(filteredSessions, new Date())
        : filteredSessions.map((session) => ({
            type: "session",
            key: session.sessionId,
            session,
          })),
    [filteredSessions, hydrated],
  );
  const isEmpty = filteredSessions.length === 0 && !hasDraft;

  if (isLoading) {
    return <SessionListSkeleton />;
  }

  if (isEmpty) {
    return (
      <p className="text-center text-muted-foreground py-8 italic">
        {emptyMessage || "No sessions yet. Create one to get started."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {/* Always render the draft slot - animates in/out via scale transform */}
      <li
        className={cn(
          "origin-top",
          hasDraft
            ? "scale-y-100 opacity-100 transition-all duration-300 ease-out"
            : "scale-y-0 opacity-0 -mb-2",
        )}
        aria-hidden={!hasDraft}
      >
        {draftSession && (
          <SessionListItem
            session={draftSession}
            onSelect={onSessionSelect}
            onDelete={() => onSessionDelete(draftSession.sessionId)}
            isDeleting={deletingSessionId === draftSession.sessionId}
            isActive={activeSessionIds?.includes(draftSession.sessionId) ?? false}
            isStreaming={false}
            isUnread={false}
            isDraft={true}
          />
        )}
      </li>
      {listEntries.map((entry) => {
        if (entry.type === "heading") {
          return (
            <li key={entry.key} className="pt-3 pb-1">
              <div className="flex items-center gap-2 px-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
                  {entry.label}
                </span>
                <span className="text-[10px] font-medium tabular-nums text-foreground/60">
                  ({entry.count})
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </li>
          );
        }

        const { session } = entry;
        const isActive = activeSessionIds?.includes(session.sessionId) ?? false;

        return (
          <li key={entry.key}>
            <SessionListItem
              session={session}
              onSelect={onSessionSelect}
              onDelete={() => onSessionDelete(session.sessionId)}
              isDeleting={deletingSessionId === session.sessionId}
              isActive={isActive}
              isStreaming={streamingSessionIds?.includes(session.sessionId) ?? false}
              isUnread={isActive ? false : (unreadSessionIds.includes(session.sessionId) ?? false)}
              isDraft={false}
            />
          </li>
        );
      })}
    </ul>
  );
}

import { useMemo } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionListItem } from "./SessionListItem";
import { buildSessionListEntries, type SessionListEntry } from "./sessionGrouping";
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
  onSessionRename: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  activeSessionIds?: string[] | null;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
  draftSessions?: SessionMetadata[];
}

export function SessionList({
  sessions,
  isLoading,
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  deletingSessionId,
  activeSessionIds,
  streamingSessionIds,
  unreadSessionIds,
  worktreeSessionIds,
  emptyMessage,
  draftSessions = [],
}: SessionListProps) {
  const hydrated = useHydrated();
  const hasDrafts = draftSessions.length > 0;
  const draftSessionIds = useMemo(
    () => new Set(draftSessions.map((draft) => draft.sessionId)),
    [draftSessions],
  );

  // Filter out draft from sessions list if it somehow got included
  const filteredSessions = sessions.filter((session) => !draftSessionIds.has(session.sessionId));
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
  const isEmpty = filteredSessions.length === 0 && !hasDrafts;

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
      {draftSessions.map((draftSession) => (
        <li key={draftSession.sessionId}>
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
        </li>
      ))}
      {listEntries.map((entry) => {
        if (entry.type === "heading") {
          return (
            <li key={entry.key} className="pt-3 pb-1">
              <div className="flex items-center gap-2 px-2">
                <span className="section-heading">{entry.label}</span>
                <span className="text-2xs font-medium tabular-nums text-foreground/60">
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
              onRename={() => onSessionRename(session.sessionId)}
              onDelete={() => onSessionDelete(session.sessionId)}
              isDeleting={deletingSessionId === session.sessionId}
              isActive={isActive}
              isStreaming={streamingSessionIds?.includes(session.sessionId) ?? false}
              isUnread={isActive ? false : (unreadSessionIds.includes(session.sessionId) ?? false)}
              isWorktree={worktreeSessionIds.includes(session.sessionId)}
              isDraft={false}
            />
          </li>
        );
      })}
    </ul>
  );
}

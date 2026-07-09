import { Fragment } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionListItem } from "./SessionListItem";
import { groupSessionsByTime } from "./sessionGrouping";
import type { SessionMetadata } from "@/types";

type SessionListProps = {
  sessions: SessionMetadata[];
  isLoading: boolean;
  onSessionSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onSessionRename: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  openSessionIds: string[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
  draftSessions: SessionMetadata[];
};

export function SessionList({
  sessions,
  isLoading,
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  deletingSessionId,
  openSessionIds,
  worktreeSessionIds,
  emptyMessage,
  draftSessions,
}: SessionListProps) {
  const hydrated = useHydrated();
  const sessionGroups = hydrated
    ? groupSessionsByTime(sessions, new Date())
    : [{ key: "sessions", sessions }];

  if (isLoading) {
    return <SessionListSkeleton />;
  }

  if (sessions.length === 0 && draftSessions.length === 0) {
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
            isActive={openSessionIds.includes(draftSession.sessionId)}
            isDraft={true}
          />
        </li>
      ))}
      {sessionGroups.map((group) => (
        <Fragment key={group.key}>
          {group.label && (
            <li className="pt-3 pb-1">
              <div className="flex items-center gap-2 px-2">
                <span className="section-heading">{group.label}</span>
                <span className="text-2xs font-medium tabular-nums text-foreground/60">
                  ({group.sessions.length})
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </li>
          )}
          {group.sessions.map((session) => {
            const isActive = openSessionIds.includes(session.sessionId);
            return (
              <li key={session.sessionId}>
                <SessionListItem
                  session={session}
                  onSelect={onSessionSelect}
                  onRename={() => onSessionRename(session.sessionId)}
                  onDelete={() => onSessionDelete(session.sessionId)}
                  isDeleting={deletingSessionId === session.sessionId}
                  isActive={isActive}
                  isWorktree={worktreeSessionIds.includes(session.sessionId)}
                />
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}

function SessionListSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 8 }, (_, index) => (
        // eslint-disable-next-line react/no-array-index-key -- static skeleton items
        <li
          key={index}
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

import { SidebarList as AnimatedSidebarList } from "@/shared/components/sidebar/SidebarList";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import type { Session } from "../../model";
import { SessionListItem } from "./SessionListItem";
import { groupSessions } from "./sessionGrouping";

const SKELETON_ROW_KEYS = [
  "skeleton-1",
  "skeleton-2",
  "skeleton-3",
  "skeleton-4",
  "skeleton-5",
  "skeleton-6",
  "skeleton-7",
  "skeleton-8",
] as const;

type SessionListProps = {
  className?: string;
  sessions: Session[];
  isLoading: boolean;
  onSessionSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onSessionRename: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  openSessionIds: string[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
};

export function SessionList({
  className,
  sessions,
  isLoading,
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  openSessionIds,
  worktreeSessionIds,
  emptyMessage,
}: SessionListProps) {
  const pinnedSessionIds = useWorkspaceSelector((workspace) => workspace.settings.pinnedSessionIds);
  const updateSetting = useUpdateWorkspaceSetting();
  const pinnedSessionIdSet = new Set(pinnedSessionIds);
  const sessionGroups = groupSessions(sessions, pinnedSessionIds, new Date());

  function handleSessionPinToggle(sessionId: string) {
    updateSetting(
      "pinnedSessionIds",
      pinnedSessionIdSet.has(sessionId)
        ? pinnedSessionIds.filter((pinnedSessionId) => pinnedSessionId !== sessionId)
        : [...pinnedSessionIds, sessionId],
    );
  }

  return (
    <AnimatedSidebarList
      rootClassName="min-h-40 flex-1"
      className={className}
      emptyState={
        <p className="text-center text-muted-foreground py-8 italic">
          {emptyMessage || "No sessions yet. Create one to get started."}
        </p>
      }
    >
      {isLoading
        ? SKELETON_ROW_KEYS.map((key) => <SessionListSkeletonItem key={key} />)
        : sessionGroups.flatMap((group) => [
            group.label ? (
              <div key={`group:${group.key}`} className="pt-3 pb-1">
                <div className="flex items-center gap-2 px-2">
                  <span className="section-heading">{group.label}</span>
                  <span className="text-2xs font-medium tabular-nums text-foreground/60">
                    ({group.sessions.length})
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </div>
            ) : null,
            ...group.sessions.map((session) => (
              <SessionListItem
                key={`session:${session.id}`}
                session={session}
                onSelect={onSessionSelect}
                onPinToggle={() => handleSessionPinToggle(session.id)}
                onRename={() => onSessionRename(session.id)}
                onDelete={() => onSessionDelete(session.id)}
                isActive={openSessionIds.includes(session.id)}
                isPinned={pinnedSessionIdSet.has(session.id)}
                isWorktree={worktreeSessionIds.includes(session.id)}
              />
            )),
          ])}
    </AnimatedSidebarList>
  );
}

function SessionListSkeletonItem() {
  return (
    <div className="flex items-center justify-between px-2 py-2 rounded-lg border border-transparent">
      <div className="flex-1 min-w-0 mr-2 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-8 w-8 rounded-md" />
    </div>
  );
}

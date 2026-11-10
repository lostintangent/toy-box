import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/shared/ui/badge";
import { SidebarList as AnimatedSidebarList } from "@/shared/sidebar/SidebarList";
import { useWorkspaceRoots } from "@workspace/hooks/layout/roots";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import type { Session } from "../../model";
import { createSessionPane } from "../../model/panes";
import { selectSessionChildren, sessionQueries } from "../../queries";
import { SessionListItem } from "./SessionListItem";
import { groupSessions } from "./sessionGrouping";

type SessionListProps = {
  className?: string;
  sessions: Session[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
};

export function SessionList({
  className,
  sessions,
  worktreeSessionIds,
  emptyMessage,
}: SessionListProps) {
  const { selectRoot, isOpen } = useWorkspaceRoots();
  const { data: childrenByParent } = useQuery({
    ...sessionQueries.state,
    select: selectSessionChildren,
  });
  const pinnedSessionIds = useWorkspaceSelector((workspace) => workspace.settings.pinnedSessionIds);
  const updateSetting = useUpdateWorkspaceSetting();
  const pinnedSessionIdSet = new Set(pinnedSessionIds);
  const [now] = useState(() => new Date());
  const sessionGroups = groupSessions(sessions, pinnedSessionIds, now);

  function handleSessionPinToggle(sessionId: string) {
    updateSetting(
      "pinnedSessionIds",
      pinnedSessionIdSet.has(sessionId)
        ? pinnedSessionIds.filter((pinnedSessionId) => pinnedSessionId !== sessionId)
        : [...pinnedSessionIds, sessionId],
    );
  }

  function handleSessionSelect(sessionId: string, toggleInWorkspace: boolean) {
    selectRoot(createSessionPane(sessionId), toggleInWorkspace);
  }

  function renderSession(session: Session, isChild = false): ReactNode {
    const children = childrenByParent?.[session.id] ?? [];
    return (
      <SessionListItem
        key={`session:${session.id}`}
        session={session}
        onSelect={handleSessionSelect}
        onPinToggle={isChild ? undefined : handleSessionPinToggle}
        isActive={isOpen(createSessionPane(session.id))}
        isPinned={!isChild && pinnedSessionIdSet.has(session.id)}
        isWorktree={worktreeSessionIds.includes(session.id)}
        childCount={children.length}
        renderChildren={
          children.length > 0
            ? () =>
                [...children]
                  .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
                  .map((child) => <li key={child.id}>{renderSession(child, true)}</li>)
            : undefined
        }
      />
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
      {sessionGroups.flatMap((group) => [
        group.label ? (
          <div key={`group:${group.key}`} className="pt-3 pb-1">
            <div className="flex items-center gap-2 px-2">
              <span className="section-heading">{group.label}</span>
              <Badge variant="count">{group.sessions.length}</Badge>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>
        ) : null,
        ...group.sessions.map((session) => renderSession(session)),
      ])}
    </AnimatedSidebarList>
  );
}

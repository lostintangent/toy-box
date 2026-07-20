import { useState } from "react";
import { SettingsDialog } from "@/components/config/SettingsDialog";
import { cn } from "@/lib/utils";
import type { SessionMetadata } from "@/types";
import { SidebarHeader } from "./shell/SidebarHeader";
import { SidebarFooter } from "./shell/SidebarFooter";
import { SessionList } from "./list/SessionList";
import { AutomationPanel } from "./automation/AutomationPanel";

export type SidebarProps = {
  filter: string;
  onFilterChange: (value: string) => void;
  showExternalSessions: boolean;
  onShowExternalSessionsChange: (value: boolean) => void;

  sessions: SessionMetadata[];
  isSessionsLoading: boolean;
  onSessionSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onSessionRename: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  openSessionIds: string[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
  draftSessions: SessionMetadata[];

  isAutomationsExpanded: boolean;
  onAutomationsExpandedChange: (expanded: boolean) => void;

  onCreateSession: (addToWorkspace: boolean) => void;
  onToggleHyper: () => void;
  isHyperOpen: boolean;
  onOpenInbox: () => void;
  isInboxOpen: boolean;

  onCollapse?: () => void;

  onToggleTerminal: () => void;
  isTerminalOpen: boolean;

  className?: string;
};

export function Sidebar({
  filter,
  onFilterChange,
  showExternalSessions,
  onShowExternalSessionsChange,

  sessions,
  isSessionsLoading,
  onSessionSelect,
  onSessionRename,
  onSessionDelete,
  deletingSessionId,
  openSessionIds,
  worktreeSessionIds,
  emptyMessage,
  draftSessions,

  isAutomationsExpanded,
  onAutomationsExpandedChange,

  onCreateSession,
  onToggleHyper,
  isHyperOpen,
  onOpenInbox,
  isInboxOpen,

  onCollapse,
  onToggleTerminal,
  isTerminalOpen,
  className,
}: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "h-full min-w-0 grid grid-rows-[auto_1fr_auto] overflow-hidden bg-background",
          className,
        )}
      >
        <SidebarHeader
          filter={filter}
          onFilterChange={onFilterChange}
          showExternalSessions={showExternalSessions}
          onShowExternalSessionsChange={onShowExternalSessionsChange}
          sessionCount={sessions.length}
          onCreateSession={onCreateSession}
          onCollapse={onCollapse}
        />

        <div className="min-h-0 min-w-0 flex flex-col bg-muted/50">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-2">
            <SessionList
              sessions={sessions}
              isLoading={isSessionsLoading}
              onSessionSelect={onSessionSelect}
              onSessionRename={onSessionRename}
              onSessionDelete={onSessionDelete}
              deletingSessionId={deletingSessionId}
              openSessionIds={openSessionIds}
              worktreeSessionIds={worktreeSessionIds}
              emptyMessage={emptyMessage}
              draftSessions={draftSessions}
            />
          </div>
          <AutomationPanel
            isExpanded={isAutomationsExpanded}
            onExpandedChange={onAutomationsExpandedChange}
            openSessionIds={openSessionIds}
            onSessionOpen={(sessionId) => onSessionSelect(sessionId, false)}
          />
        </div>

        <SidebarFooter
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleHyper={onToggleHyper}
          isHyperOpen={isHyperOpen}
          onOpenInbox={onOpenInbox}
          isInboxOpen={isInboxOpen}
          onToggleTerminal={onToggleTerminal}
          isTerminalOpen={isTerminalOpen}
        />
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

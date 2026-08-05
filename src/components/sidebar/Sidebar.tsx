import { useState } from "react";
import { ScrollableFade } from "@/components/ui/scrollable-fade";
import { cn } from "@/lib/utils";
import type { SessionMetadata } from "@/types";
import { AutomationPanel } from "./automations/AutomationPanel";
import { AppsPanel } from "./apps/AppsPanel";
import { SettingsDialog } from "./shell/SettingsDialog";
import { SidebarHeader, type SidebarCreateOptions } from "./shell/SidebarHeader";
import { SidebarFooter } from "./shell/SidebarFooter";
import { SessionList } from "./sessions/SessionList";
import { FileBrowserDialog } from "@/components/workspace/fs/FileBrowserDialog";

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
  isAppsExpanded: boolean;
  onAppsExpandedChange: (expanded: boolean) => void;

  onCreateSession: (options?: SidebarCreateOptions) => void;
  openAppIds: string[];
  onAppOpen: (appId: string, toggleInWorkspace: boolean) => void;
  onAppOpenInHyper: (appId: string) => void;
  onToggleHyper: () => void;
  isHyperOpen: boolean;
  onOpenInbox: () => void;
  isInboxOpen: boolean;

  onCollapse?: () => void;

  onToggleTerminal: () => void;
  isTerminalOpen: boolean;

  onOpenFile: (path: string) => void;

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
  isAppsExpanded,
  onAppsExpandedChange,

  onCreateSession,
  openAppIds,
  onAppOpen,
  onAppOpenInHyper,
  onToggleHyper,
  isHyperOpen,
  onOpenInbox,
  isInboxOpen,

  onCollapse,
  onToggleTerminal,
  isTerminalOpen,
  onOpenFile,
  className,
}: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);

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
          <ScrollableFade axis="vertical" className="min-h-0 min-w-0 flex-1 px-3 py-2">
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
          </ScrollableFade>

          <AppsPanel
            isExpanded={isAppsExpanded}
            onExpandedChange={onAppsExpandedChange}
            openAppIds={openAppIds}
            onAppOpen={onAppOpen}
            onAppOpenInHyper={onAppOpenInHyper}
          />

          <AutomationPanel
            isExpanded={isAutomationsExpanded}
            onExpandedChange={onAutomationsExpandedChange}
            openSessionIds={openSessionIds}
            onSessionOpen={(sessionId) => onSessionSelect(sessionId, false)}
          />
        </div>

        <SidebarFooter
          onOpenSettings={() => setSettingsOpen(true)}
          onBrowseFiles={() => setBrowseOpen(true)}
          onToggleHyper={onToggleHyper}
          isHyperOpen={isHyperOpen}
          onOpenInbox={onOpenInbox}
          isInboxOpen={isInboxOpen}
          onToggleTerminal={onToggleTerminal}
          isTerminalOpen={isTerminalOpen}
        />
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <FileBrowserDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        title="Open a file"
        onOpenFile={onOpenFile}
      />
    </>
  );
}

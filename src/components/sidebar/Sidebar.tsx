import { useState } from "react";
import { SettingsDialog } from "@/components/config/SettingsDialog";
import { cn } from "@/lib/utils";
import type {
  Automation,
  AutomationOptions,
  ModelConfiguration,
  SessionMetadata,
  ModelInfo,
} from "@/types";
import type { SessionDirectoryOption } from "@/components/workspace/panes/session/location/directory/directoryOptions";
import { SidebarHeader } from "./shell/SidebarHeader";
import { SidebarFooter } from "./shell/SidebarFooter";
import { SessionList } from "./list/SessionList";
import { AutomationPanel } from "./automation/AutomationPanel";

export interface SidebarProps {
  // Filter props
  filter: string;
  onFilterChange: (value: string) => void;
  showChildSessions: boolean;
  onShowChildSessionsChange: (value: boolean) => void;
  showExternalSessions: boolean;
  onShowExternalSessionsChange: (value: boolean) => void;

  // Session list props
  sessions: SessionMetadata[];
  isLoading: boolean;
  onSessionSelect: (sessionId: string | null, modifierKey?: boolean) => void;
  onSessionRename: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  activeSessionIds: string[];
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
  draftSessions: SessionMetadata[];
  directoryOptions: SessionDirectoryOption[];

  // Automation panel props
  automations: Automation[];
  isAutomationsLoading: boolean;
  models: ModelInfo[];
  defaultAutomationModelConfiguration?: ModelConfiguration;
  isAutomationsExpanded: boolean;
  onAutomationsExpandedChange: (expanded: boolean) => void;
  onCreateAutomation: (input: AutomationOptions) => Promise<void>;
  onUpdateAutomation: (input: AutomationOptions & { automationId: string }) => Promise<void>;
  onDeleteAutomation: (automationId: string) => Promise<void>;
  onRunAutomation: (automationId: string) => Promise<void>;
  creatingAutomation?: boolean;
  updatingAutomationId?: string | null;
  deletingAutomationId?: string | null;
  runningAutomationIds?: Set<string>;

  // Action props
  onCreateSession: (e?: React.MouseEvent) => void;
  onToggleHyper?: () => void;
  isHyperOpen?: boolean;
  hasHyperSessions?: boolean;

  // Shell props (desktop only)
  onCollapse?: () => void;

  // Terminal props
  onToggleTerminal?: () => void;
  isTerminalOpen?: boolean;

  // Styling
  className?: string;
}

export function Sidebar({
  // Filter props
  filter,
  onFilterChange,
  showChildSessions,
  onShowChildSessionsChange,
  showExternalSessions,
  onShowExternalSessionsChange,

  // Session list props
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
  draftSessions,
  directoryOptions,

  // Automation panel props
  automations,
  isAutomationsLoading,
  models,
  defaultAutomationModelConfiguration,
  isAutomationsExpanded,
  onAutomationsExpandedChange,
  onCreateAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
  onRunAutomation,
  creatingAutomation,
  updatingAutomationId,
  deletingAutomationId,
  runningAutomationIds,

  // Action props
  onCreateSession,
  onToggleHyper,
  isHyperOpen,
  hasHyperSessions,

  // Shell props
  onCollapse,

  // Terminal props
  onToggleTerminal,
  isTerminalOpen,

  // Styling
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
          showChildSessions={showChildSessions}
          onShowChildSessionsChange={onShowChildSessionsChange}
          showExternalSessions={showExternalSessions}
          onShowExternalSessionsChange={onShowExternalSessionsChange}
          filteredSessionsCount={sessions.length}
          onCreateSession={onCreateSession}
          onCollapse={onCollapse}
        />

        <div className="min-h-0 min-w-0 flex flex-col bg-muted/50">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-2">
            <SessionList
              sessions={sessions}
              isLoading={isLoading}
              onSessionSelect={onSessionSelect}
              onSessionRename={onSessionRename}
              onSessionDelete={onSessionDelete}
              deletingSessionId={deletingSessionId}
              activeSessionIds={activeSessionIds}
              streamingSessionIds={streamingSessionIds}
              unreadSessionIds={unreadSessionIds}
              worktreeSessionIds={worktreeSessionIds}
              emptyMessage={emptyMessage}
              draftSessions={draftSessions}
            />
          </div>
          <AutomationPanel
            automations={automations}
            isLoading={isAutomationsLoading}
            models={models}
            defaultModelConfiguration={defaultAutomationModelConfiguration}
            directoryOptions={directoryOptions}
            isExpanded={isAutomationsExpanded}
            onExpandedChange={onAutomationsExpandedChange}
            activeSessionIds={activeSessionIds}
            unreadSessionIds={unreadSessionIds}
            onSessionSelect={onSessionSelect}
            onCreateAutomation={onCreateAutomation}
            onUpdateAutomation={onUpdateAutomation}
            onDeleteAutomation={onDeleteAutomation}
            onRunAutomation={onRunAutomation}
            creatingAutomation={creatingAutomation}
            updatingAutomationId={updatingAutomationId}
            deletingAutomationId={deletingAutomationId}
            runningAutomationIds={runningAutomationIds}
          />
        </div>

        <SidebarFooter
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleHyper={onToggleHyper}
          isHyperOpen={isHyperOpen}
          hasHyperSessions={hasHyperSessions}
          onToggleTerminal={onToggleTerminal}
          isTerminalOpen={isTerminalOpen}
        />
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

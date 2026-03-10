import { cn } from "@/lib/utils";
import type { Automation, AutomationOptions, SessionMetadata, ModelInfo } from "@/types";
import type { SessionDirectoryOption } from "@/components/session/sessionDirectoryOptions";
import { SidebarHeader, type SessionSourceFilter } from "./shell/SidebarHeader";
import { SidebarFooter } from "./shell/SidebarFooter";
import { SessionList } from "./list/SessionList";
import { AutomationPanel } from "./automation/AutomationPanel";

export type { SessionSourceFilter };

export interface SidebarProps {
  // Filter props
  filter: string;
  onFilterChange: (value: string) => void;
  sourceFilter: SessionSourceFilter;
  onSourceFilterChange: (value: SessionSourceFilter) => void;

  // Session list props
  sessions: SessionMetadata[];
  isLoading: boolean;
  onSessionSelect: (sessionId: string | null, modifierKey?: boolean) => void;
  onSessionDelete: (sessionId: string) => void;
  deletingSessionId: string | null;
  activeSessionIds: string[];
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  worktreeSessionIds: string[];
  emptyMessage?: string;
  draftSession: SessionMetadata | null;
  directoryOptions: SessionDirectoryOption[];

  // Automation panel props
  automations: Automation[];
  isAutomationsLoading: boolean;
  models: ModelInfo[];
  defaultAutomationModelId?: string;
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
  sourceFilter,
  onSourceFilterChange,

  // Session list props
  sessions,
  isLoading,
  onSessionSelect,
  onSessionDelete,
  deletingSessionId,
  activeSessionIds,
  streamingSessionIds,
  unreadSessionIds,
  worktreeSessionIds,
  emptyMessage,
  draftSession,
  directoryOptions,

  // Automation panel props
  automations,
  isAutomationsLoading,
  models,
  defaultAutomationModelId,
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

  // Shell props
  onCollapse,

  // Terminal props
  onToggleTerminal,
  isTerminalOpen,

  // Styling
  className,
}: SidebarProps) {
  return (
    <div
      className={cn(
        "h-full min-w-0 grid grid-rows-[auto_1fr_auto] overflow-hidden bg-background",
        className,
      )}
    >
      <SidebarHeader
        filter={filter}
        onFilterChange={onFilterChange}
        sourceFilter={sourceFilter}
        onSourceFilterChange={onSourceFilterChange}
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
            onSessionDelete={onSessionDelete}
            deletingSessionId={deletingSessionId}
            activeSessionIds={activeSessionIds}
            streamingSessionIds={streamingSessionIds}
            unreadSessionIds={unreadSessionIds}
            worktreeSessionIds={worktreeSessionIds}
            emptyMessage={emptyMessage}
            draftSession={draftSession}
          />
        </div>
        <AutomationPanel
          automations={automations}
          isLoading={isAutomationsLoading}
          models={models}
          defaultModelId={defaultAutomationModelId}
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

      <SidebarFooter onToggleTerminal={onToggleTerminal} isTerminalOpen={isTerminalOpen} />
    </div>
  );
}

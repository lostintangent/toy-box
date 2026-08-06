import { useState } from "react";
import { ScrollableFade } from "@/components/ui/scrollable-fade";
import { cn } from "@/lib/utils";
import type { SessionMetadata } from "@/types";
import { AutomationPanel } from "./automations/AutomationPanel";
import { AppsPanel } from "./apps/AppsPanel";
import { SettingsDialog } from "./shell/dialogs/SettingsDialog";
import { SidebarHeader } from "./shell/SidebarHeader";
import { SidebarFooter } from "./shell/SidebarFooter";
import { SidebarRail } from "./shell/SidebarRail";
import { SidebarResizer, type SidebarCollapseControl } from "./shell/SidebarResizer";
import {
  ActionSpacer,
  CollapseToggle,
  SettingsButton,
  type SidebarCreateOptions,
} from "./shell/SidebarActions";
import { SessionList } from "./sessions/SessionList";
import { FileBrowserDialog } from "@/components/workspace/fs/FileBrowserDialog";

/**
 * Crossfade one of the sidebar's two layouts. Whichever layout is leaving clears
 * out quickly, so the narrowing sidebar never shows squeezed content, and the
 * arriving one lands as the width settles.
 */
function layerClass(visible: boolean): string {
  return cn(
    "transition-opacity ease-out motion-reduce:transition-none",
    visible ? "opacity-100 delay-150 duration-200" : "pointer-events-none opacity-0 duration-100",
  );
}

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

  /**
   * Desktop only, and the presence of this is what makes the sidebar
   * collapsible. The sidebar owns how it resizes and collapses; the layout above
   * only holds the resulting width and chooses whether this is a sidebar that
   * collapses at all.
   */
  collapsible?: SidebarCollapseControl;

  onToggleTerminal: () => void;
  isTerminalOpen: boolean;

  onOpenFile: (path: string) => void;

  className?: string;
};

/**
 * The sidebar presents two layouts over one origin: the expanded rows and, on
 * desktop, the collapsed rail. They crossfade rather than swap, and the collapse
 * toggle and settings actions are pinned outside both so the two states share
 * their exact position and the morph reads as content leaving, not chrome
 * moving. The pinned actions replace nothing on mobile, where the sidebar is the
 * whole screen and never collapses.
 */
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

  collapsible,
  onToggleTerminal,
  isTerminalOpen,
  onOpenFile,
  className,
}: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);

  // Only a collapsible sidebar pins the collapse toggle and settings actions
  // outside its two layouts, and only it has a rail for them to head and foot.
  const collapsed = collapsible?.collapsed ?? false;

  /*
    The sidebar clips its two layouts; it is never a scroll port. `clip` rather
    than `hidden` keeps it out of `scrollIntoView`'s ancestor walk, so revealing
    a session row in the expanded layout can never scroll the collapsed rail and
    its pinned actions out of view.
  */
  const body = (
    <div className={cn("relative h-full min-w-0 overflow-clip bg-background", className)}>
      {collapsible && (
        <div
          // Pinned to the same inset the header and footer rows pad to, and
          // centered in the same row height the header's controls set, so the
          // toggle lands on one pixel in both layouts.
          className="absolute top-3 left-2.5 z-10 flex h-8 items-center"
        >
          <CollapseToggle
            collapsed={collapsed}
            onToggle={() => collapsible.onCollapsedChange(!collapsed)}
          />
        </div>
      )}

      <div
        aria-hidden={collapsed}
        inert={collapsed}
        className={cn(
          "absolute inset-y-0 left-0 grid w-[var(--sidebar-width,100%)] grid-rows-[auto_1fr_auto] overflow-clip",
          layerClass(!collapsed),
        )}
      >
        <SidebarHeader
          leadingSlot={collapsible ? <ActionSpacer /> : undefined}
          filter={filter}
          onFilterChange={onFilterChange}
          showExternalSessions={showExternalSessions}
          onShowExternalSessionsChange={onShowExternalSessionsChange}
          sessionCount={sessions.length}
          onCreateSession={onCreateSession}
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
          leadingSlot={
            collapsible ? (
              <ActionSpacer />
            ) : (
              <SettingsButton onOpenSettings={() => setSettingsOpen(true)} />
            )
          }
          onBrowseFiles={() => setBrowseOpen(true)}
          onToggleHyper={onToggleHyper}
          isHyperOpen={isHyperOpen}
          onOpenInbox={onOpenInbox}
          isInboxOpen={isInboxOpen}
          onToggleTerminal={onToggleTerminal}
          isTerminalOpen={isTerminalOpen}
        />
      </div>

      {collapsible && (
        <SidebarRail
          collapsed={collapsed}
          className={layerClass(collapsed)}
          onCreateSession={onCreateSession}
          onBrowseFiles={() => setBrowseOpen(true)}
          onToggleHyper={onToggleHyper}
          isHyperOpen={isHyperOpen}
          onToggleTerminal={onToggleTerminal}
          isTerminalOpen={isTerminalOpen}
        />
      )}

      {collapsible && (
        <div className="absolute bottom-3 left-2.5 z-10 flex">
          <SettingsButton onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      )}
    </div>
  );

  return (
    <>
      {collapsible ? <SidebarResizer {...collapsible}>{body}</SidebarResizer> : body}

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

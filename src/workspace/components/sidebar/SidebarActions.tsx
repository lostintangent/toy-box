import type { MouseEvent, ReactNode } from "react";
import {
  CircleHelp,
  FolderOpen,
  Loader2,
  MessageCirclePlus,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
  SquareTerminal,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Toggle } from "@/shared/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { useWorkspaceSelector, useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { cn } from "@/shared/utils";

export type SidebarCreateOptions = {
  addToWorkspace?: boolean;
  artifact?: { path: string; content: string };
};

/** The box every sidebar action occupies, which is also what the rail is one of across. */
const SIDEBAR_ACTION_SIZE = "size-6";

/**
 * One of the sidebar's actions: an icon in an action-sized box, named by
 * the tooltip it carries. The expanded header and footer rows and the collapsed
 * rail's vertical stacks all draw from these, so rotating a row into a column
 * changes only the container.
 */
function SidebarAction({
  label,
  onClick,
  variant = "ghost",
  className,
  children,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  variant?: "ghost" | "accent";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="icon"
          className={cn(SIDEBAR_ACTION_SIZE, className)}
          onClick={onClick}
          aria-label={label}
          suppressHydrationWarning
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * An action-shaped hole beneath a pinned action. A collapsible sidebar pins its
 * collapse and settings actions outside its two layouts so they hold still
 * across the collapse, and every row or stack those actions belong to reserves
 * one of these where each lands.
 */
export function ActionSpacer({ className }: { className?: string }) {
  return <div className={cn("shrink-0", SIDEBAR_ACTION_SIZE, className)} aria-hidden />;
}

export function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <SidebarAction label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggle}>
      {/* Stacked glyphs crossfade in place so the pinned button never resizes. */}
      <span className="relative size-4">
        <PanelLeftClose
          className={cn("absolute inset-0 size-4 transition-opacity", collapsed && "opacity-0")}
          suppressHydrationWarning
        />
        <PanelLeft
          className={cn("absolute inset-0 size-4 transition-opacity", !collapsed && "opacity-0")}
          suppressHydrationWarning
        />
      </span>
    </SidebarAction>
  );
}

export function NewSessionButton({
  onCreateSession,
  className,
}: {
  onCreateSession: (options?: SidebarCreateOptions) => void;
  className?: string;
}) {
  return (
    <SidebarAction
      label="New session"
      variant="accent"
      className={className}
      onClick={(event) => onCreateSession({ addToWorkspace: event.metaKey || event.ctrlKey })}
    >
      <Plus />
    </SidebarAction>
  );
}

export function HyperButton({ onToggle, isOpen }: { onToggle: () => void; isOpen: boolean }) {
  const hyperSessionId = useWorkspaceSelector((workspace) => workspace.hyperSessionIds[0]);

  return (
    <SidebarAction label="Toggle hyper session" onClick={onToggle} className="relative inline-flex">
      {hyperSessionId ? (
        <HyperSessionStatus sessionId={hyperSessionId} isOpen={isOpen} />
      ) : (
        <MessageCirclePlus />
      )}
    </SidebarAction>
  );
}

export function BrowseFilesButton({ onBrowseFiles }: { onBrowseFiles: () => void }) {
  return (
    <SidebarAction label="Browse files" onClick={onBrowseFiles}>
      <FolderOpen />
    </SidebarAction>
  );
}

/** The terminal is a state the sidebar reports, not an action, so it presses. */
export function TerminalToggle({
  isTerminalOpen,
  onToggleTerminal,
}: {
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={isTerminalOpen}
          onPressedChange={() => onToggleTerminal()}
          size="sm"
          className={cn(
            SIDEBAR_ACTION_SIZE,
            "min-w-6 p-0 hover:bg-accent hover:text-accent-foreground",
          )}
          aria-label="Toggle terminal"
        >
          <SquareTerminal />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Toggle terminal</TooltipContent>
    </Tooltip>
  );
}

export function SettingsButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <SidebarAction label="Edit settings" onClick={onOpenSettings}>
      <Settings />
    </SidebarAction>
  );
}

function HyperSessionStatus({ sessionId, isOpen }: { sessionId: string; isOpen: boolean }) {
  const { running, waiting } = useWorkspaceSessionActivity(sessionId);

  return (
    <>
      {waiting && !isOpen ? (
        <CircleHelp />
      ) : running && !isOpen ? (
        <Loader2 className="animate-spin" />
      ) : (
        <MessageCirclePlus />
      )}
      {!running && !waiting && !isOpen && (
        <span className="absolute right-px top-px h-2.5 w-2.5 rounded-full bg-user-accent ring-2 ring-inset ring-background" />
      )}
    </>
  );
}

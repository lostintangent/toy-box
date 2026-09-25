import type { MouseEvent, ReactNode } from "react";
import { useHasModels } from "@providers/useModels";
import {
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  FolderOpen,
  Hash,
  Loader2,
  MessageCirclePlus,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
  Shapes,
  SquareTerminal,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Toggle } from "@/shared/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useWorkspaceSelector, useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { cn } from "@/shared/utils";

export type SessionCreationOptions = {
  addToWorkspace?: boolean;
  artifact?: { path: string; content: string };
};

/** The box every sidebar action occupies, which is also what the rail is one of across. */
const SIDEBAR_ACTION_SIZE = "size-6";

/** One icon action shared by the expanded rows and collapsed rail. */
function SidebarAction({
  label,
  onClick,
  variant = "ghost",
  className,
  disabled,
  showTooltip = true,
  children,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  variant?: "ghost" | "accent";
  className?: string;
  disabled?: boolean;
  showTooltip?: boolean;
  children: ReactNode;
}) {
  const action = (
    <Button
      type="button"
      variant={variant}
      size="icon"
      className={cn(SIDEBAR_ACTION_SIZE, className)}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      suppressHydrationWarning
    >
      {children}
    </Button>
  );

  if (!showTooltip) return action;

  return (
    <Tooltip>
      <TooltipTrigger render={action} />
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
    <SidebarAction
      label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      onClick={onToggle}
      showTooltip={false}
    >
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

type SidebarCreationActions = {
  onCreateSession: (options?: SessionCreationOptions) => void;
  onCreateAutomation: () => void;
  onCreateChannel: () => void;
};
type SidebarCreationVariant = "header" | "rail";

function SidebarCreationMenu({
  onCreateSession,
  onCreateAutomation,
  onCreateChannel,
  disabled = false,
  variant,
}: SidebarCreationActions & {
  disabled?: boolean;
  variant: SidebarCreationVariant;
}) {
  const rail = variant === "rail";

  function createArtifactDraft(path: string, content = "") {
    onCreateSession({ artifact: { path, content } });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            size="icon-sm"
            variant="accent"
            className={
              rail
                ? "absolute left-0 top-full h-3 w-6 rounded-t-none border-t border-background pointer-events-none opacity-0 transition-opacity motion-reduce:transition-none group-hover/create:pointer-events-auto group-hover/create:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-popup-open:pointer-events-auto data-popup-open:opacity-100 disabled:hidden"
                : "h-7 w-5 rounded-l-none border-l border-background"
            }
            aria-label="Create options"
            suppressHydrationWarning
          />
        }
      >
        <ChevronDown className={rail ? "size-2.5" : "size-3.5"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={rail ? "start" : "end"} side={rail ? "right" : "bottom"}>
        <DropdownMenuItem onClick={() => createArtifactDraft("document.md")}>
          <FileText />
          New document
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            createArtifactDraft(
              "diagram.svg",
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"></svg>\n',
            )
          }
        >
          <Shapes />
          New whiteboard
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCreateAutomation}>
          <Clock3 />
          Create automation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateChannel}>
          <Hash />
          Create channel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarSplitButton({
  variant = "header",
  ...actions
}: SidebarCreationActions & { variant?: SidebarCreationVariant }) {
  const hasModels = useHasModels();
  const rail = variant === "rail";

  return (
    <div className={cn("flex", rail && "group/create relative shrink-0")}>
      <SidebarAction
        label="New session"
        variant="accent"
        className={cn(
          !rail && "size-7 rounded-r-none",
          rail &&
            hasModels &&
            "group-hover/create:rounded-b-none group-has-[[data-slot=dropdown-menu-trigger]:focus-visible]/create:rounded-b-none group-has-data-[popup-open]/create:rounded-b-none",
        )}
        disabled={!hasModels}
        showTooltip={false}
        onClick={(event) =>
          actions.onCreateSession({ addToWorkspace: event.metaKey || event.ctrlKey })
        }
      >
        <Plus />
      </SidebarAction>
      <SidebarCreationMenu {...actions} disabled={!hasModels} variant={variant} />
    </div>
  );
}

export function HyperButton({ onToggle, isOpen }: { onToggle: () => void; isOpen: boolean }) {
  const hyperSessionId = useWorkspaceSelector((workspace) => workspace.hyperSessionIds[0]);
  const hasModels = useHasModels();

  return (
    <SidebarAction
      label="Toggle hyper session"
      onClick={onToggle}
      disabled={!hasModels}
      className="relative inline-flex"
    >
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
      <TooltipTrigger
        render={
          <Toggle
            pressed={isTerminalOpen}
            onPressedChange={() => onToggleTerminal()}
            size="sm"
            className={cn(
              SIDEBAR_ACTION_SIZE,
              "min-w-6 p-0 hover:bg-accent/50 hover:text-accent-foreground",
            )}
            aria-label="Toggle terminal"
          >
            <SquareTerminal />
          </Toggle>
        }
      />
      <TooltipContent sideOffset={6}>Toggle terminal</TooltipContent>
    </Tooltip>
  );
}

export function SettingsButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <SidebarAction label="Edit settings" onClick={onOpenSettings} showTooltip={false}>
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
        <span className="absolute right-px top-px h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-inset ring-background" />
      )}
    </>
  );
}

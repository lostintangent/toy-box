import type { ReactNode } from "react";
import {
  ChevronDown,
  FolderOpen,
  MessageCirclePlus,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { executeCommand } from "@/shared/commands/command";
import { CommandButton } from "@/shared/commands/CommandButton";
import { CommandMenuItem } from "@/shared/commands/CommandMenuItem";
import { useCommand } from "@/shared/commands/CommandProvider";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { Toggle } from "@/shared/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useSessionActivity } from "@sessions/useSessionActivity";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { cn } from "@/shared/utils";

/** The box every sidebar action occupies, which is also what the rail is one of across. */
const SIDEBAR_ACTION_SIZE = "size-6";

/** One command's icon action, shared by the expanded rows and collapsed rail. */
function SidebarAction({
  command,
  variant = "ghost",
  className,
  children,
}: {
  command: string;
  variant?: "ghost" | "accent";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <CommandButton
      command={command}
      variant={variant}
      size="icon"
      className={cn(SIDEBAR_ACTION_SIZE, className)}
      suppressHydrationWarning
    >
      {children}
    </CommandButton>
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

export function CollapseToggle() {
  const collapsed = !useCommand("workspace.toggleSidebar")?.checked;

  return (
    <SidebarAction command="workspace.toggleSidebar">
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

type SidebarCreationVariant = "header" | "rail";

function SidebarCreationMenu({
  disabled = false,
  variant,
}: {
  disabled?: boolean;
  variant: SidebarCreationVariant;
}) {
  const rail = variant === "rail";

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
        <CommandMenuItem command="session.createDocument" />
        <CommandMenuItem command="session.createWhiteboard" />
        <DropdownMenuSeparator />
        <CommandMenuItem command="automation.create" />
        <CommandMenuItem command="channel.create" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarSplitButton({ variant = "header" }: { variant?: SidebarCreationVariant }) {
  const disabled = useCommand("session.create")?.disabled ?? true;
  const rail = variant === "rail";

  return (
    <div className={cn("flex", rail && "group/create relative shrink-0")}>
      <SidebarAction
        command="session.create"
        variant="accent"
        className={cn(
          !rail && "size-7 rounded-r-none",
          rail &&
            !disabled &&
            "group-hover/create:rounded-b-none group-has-[[data-slot=dropdown-menu-trigger]:focus-visible]/create:rounded-b-none group-has-data-[popup-open]/create:rounded-b-none",
        )}
      />
      <SidebarCreationMenu disabled={disabled} variant={variant} />
    </div>
  );
}

/** Toward the workspace: up from the footer, or right of the rail. */
type MenuSide = "top" | "right";

/** Starts or finds work from the sidebar, as one action: Hyper, or the command palette. */
export function HyperMenu({ side }: { side: MenuSide }) {
  const hyperSessionId = useWorkspaceSelector((workspace) => workspace.hyperSessionIds[0]);
  const isOpen = useCommand("workspace.toggleHyper")?.checked ?? false;

  return (
    <SidebarMenu
      label="Hyper and search"
      side={side}
      commands={["workspace.toggleHyper", "workspace.search"]}
    >
      {hyperSessionId ? (
        <HyperSessionStatus sessionId={hyperSessionId} isOpen={isOpen} />
      ) : (
        <MessageCirclePlus />
      )}
    </SidebarMenu>
  );
}

/** Opens a file or a screen from the sidebar, as one action. */
export function BrowseMenu({ side }: { side: MenuSide }) {
  return (
    <SidebarMenu label="Browse" side={side} commands={["files.browse", "screens.browse"]}>
      <FolderOpen />
    </SidebarMenu>
  );
}

function SidebarMenu({
  label,
  side,
  commands,
  children,
}: {
  label: string;
  side: MenuSide;
  commands: readonly string[];
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(SIDEBAR_ACTION_SIZE, "relative")}
            aria-label={label}
            suppressHydrationWarning
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={side === "top" ? "end" : "start"}>
        {commands.map((command) => (
          <CommandMenuItem key={command} command={command} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The terminal is a state the sidebar reports, not an action, so it presses. */
export function TerminalToggle() {
  const command = useCommand("workspace.toggleTerminal");
  if (!command) return null;
  const Icon = command.icon!;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            pressed={command.checked}
            onPressedChange={() => void executeCommand(command)}
            size="sm"
            className={cn(
              SIDEBAR_ACTION_SIZE,
              "min-w-6 p-0 hover:bg-accent/50 hover:text-accent-foreground",
            )}
            aria-label={command.title}
          >
            <Icon />
          </Toggle>
        }
      />
      <TooltipContent sideOffset={6}>{command.title}</TooltipContent>
    </Tooltip>
  );
}

export function SettingsButton() {
  return <SidebarAction command="workspace.settings" />;
}

function HyperSessionStatus({ sessionId, isOpen }: { sessionId: string; isOpen: boolean }) {
  const { running, waiting } = useSessionActivity(sessionId);

  return (
    <>
      {(running || waiting) && !isOpen ? (
        <RunningIndicator waiting={waiting} />
      ) : (
        <MessageCirclePlus />
      )}
      {!running && !waiting && !isOpen && (
        <span className="absolute right-px top-px h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-inset ring-background" />
      )}
    </>
  );
}

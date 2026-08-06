import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { BrowseFilesButton, HyperButton, TerminalToggle } from "./SidebarActions";

export function SidebarFooter({
  leadingSlot,
  onBrowseFiles,
  onToggleHyper,
  isHyperOpen,
  onOpenInbox,
  isInboxOpen,
  onToggleTerminal,
  isTerminalOpen,
}: {
  /** The row's first item: an action that survives collapse, or a spacer holding its place. */
  leadingSlot?: ReactNode;
  onBrowseFiles: () => void;
  onToggleHyper: () => void;
  isHyperOpen: boolean;
  onOpenInbox: () => void;
  isInboxOpen: boolean;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
}) {
  const appTitle = import.meta.env.VITE_APP_TITLE;
  const hasUnreadInbox = useWorkspaceSelector((workspace) =>
    workspace.inboxEntries.some((entry) => workspace.sessionStates[entry.id]?.status === "unread"),
  );
  const showInboxUnreadIndicator = !isInboxOpen && hasUnreadInbox;

  return (
    <div className="pt-3 md:pb-3 px-2.5 border-t flex items-center justify-between">
      <div className="flex items-center gap-2">
        {leadingSlot}
        <Separator
          orientation="vertical"
          className="h-4! w-px! bg-muted-foreground/50! mx-1 translate-y-px"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenInbox}
              className="relative font-bold text-foreground transition-colors hover:text-primary"
              aria-label={
                showInboxUnreadIndicator ? `${appTitle}, unread inbox activity` : appTitle
              }
            >
              {appTitle}
              {showInboxUnreadIndicator && (
                <span
                  className="absolute -right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-unread "
                  aria-hidden="true"
                />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>Open inbox</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-3">
        <HyperButton onToggle={onToggleHyper} isOpen={isHyperOpen} />
        <BrowseFilesButton onBrowseFiles={onBrowseFiles} />
        <TerminalToggle isTerminalOpen={isTerminalOpen} onToggleTerminal={onToggleTerminal} />
      </div>
    </div>
  );
}

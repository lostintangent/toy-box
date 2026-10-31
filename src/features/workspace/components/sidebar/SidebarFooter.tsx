import type { ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { inboxQueries } from "@inbox/queries";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { executeCommand } from "@/shared/commands/command";
import { useCommand } from "@/shared/commands/CommandProvider";
import { BrowseMenu, HyperMenu, TerminalToggle } from "./SidebarActions";

export function SidebarFooter({
  leadingSlot,
}: {
  /** The row's first item: an action that survives collapse, or a spacer holding its place. */
  leadingSlot?: ReactNode;
}) {
  const appTitle = import.meta.env.VITE_APP_TITLE;
  const { data: inboxEntries } = useSuspenseQuery(inboxQueries.list());
  const hasUnreadInbox = useSessionsActivity((activities) =>
    inboxEntries.some((entry) => activities[entry.id]?.status === "unread"),
  );
  const openInbox = useCommand("workspace.openInbox");
  const showInboxUnreadIndicator = !openInbox?.checked && hasUnreadInbox;

  return (
    <div className="pt-3 md:pb-3 px-2.5 border-t flex items-center justify-between">
      <div className="flex items-center gap-2">
        {leadingSlot}
        <Separator
          orientation="vertical"
          className="h-4! w-px! bg-muted-foreground/50! mx-1 translate-y-px"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => openInbox && void executeCommand(openInbox)}
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
            }
          />
          <TooltipContent sideOffset={6}>Open inbox</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-3">
        <HyperMenu side="top" />
        <BrowseMenu side="top" />
        <TerminalToggle />
      </div>
    </div>
  );
}

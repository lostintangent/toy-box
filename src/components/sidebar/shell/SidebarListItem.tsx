import type { ComponentProps, ReactNode } from "react";
import { Circle, Loader2, MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollableFade } from "@/components/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SessionPreview,
  useSessionPreview,
} from "@/components/workspace/panes/session/SessionPreview";
import { useViewport } from "@/hooks/browser/useViewport";
import { useWorkspaceSessionActivity } from "@/hooks/workspace/state";
import { cn } from "@/lib/utils";

type SidebarListItemProps = Omit<ComponentProps<"button">, "children" | "className" | "title"> & {
  sessionId: string;
  title: string;
  time?: ReactNode;
  badges?: ReactNode;
  menuItems: ReactNode;
  menuDisabled?: boolean;
  isActive?: boolean;
  previewDisabled?: boolean;
  className?: string;
  buttonClassName?: string;
  titleClassName?: string;
};

export function SidebarListItem({
  sessionId,
  title,
  time,
  badges,
  menuItems,
  menuDisabled = false,
  isActive = false,
  previewDisabled = false,
  className,
  buttonClassName,
  titleClassName,
  disabled,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...props
}: SidebarListItemProps) {
  const { hydrated, isMobile } = useViewport();
  const { running, unread, hasDraftPrompt } = useWorkspaceSessionActivity(sessionId);
  const preview = useSessionPreview(isActive || previewDisabled || disabled);
  const showUnread = unread && !isActive;

  function scrollIntoViewRef(node: HTMLDivElement | null) {
    if (!node || !isActive || !hydrated || isMobile) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    preview.close();
    onClick?.(event);
  }

  function handleMouseEnter(event: React.MouseEvent<HTMLButtonElement>) {
    onMouseEnter?.(event);
    preview.onMouseEnter(event);
  }

  function handleMouseLeave(event: React.MouseEvent<HTMLButtonElement>) {
    onMouseLeave?.(event);
    preview.onMouseLeave();
  }

  return (
    <div
      ref={scrollIntoViewRef}
      className={cn(
        "flex items-center justify-between rounded-lg px-2 py-2 transition-colors",
        isActive
          ? "bg-foreground/24 ring-1 ring-border/70"
          : preview.open
            ? "bg-foreground/14"
            : "hover:bg-foreground/14",
        className,
      )}
    >
      <SessionPreview
        sessionId={sessionId}
        open={preview.open}
        onMouseEnter={preview.onMouseEnter}
        onMouseLeave={preview.onMouseLeave}
      >
        <button
          {...props}
          disabled={disabled}
          aria-current={isActive ? "page" : undefined}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn("mr-2 min-w-0 flex-1 text-left", buttonClassName)}
        >
          <ScrollableFade asChild className={cn("block whitespace-nowrap", titleClassName)}>
            <span>{title}</span>
          </ScrollableFade>
          {(time || badges) && (
            <span className="mt-1 flex min-w-0 items-center gap-1.5">
              {time && (
                <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground/70">
                  {time}
                </span>
              )}
              {badges}
            </span>
          )}
        </button>
      </SessionPreview>

      <SidebarListItemAction
        title={title}
        running={running}
        unread={showUnread}
        hasDraftPrompt={hasDraftPrompt}
        menuDisabled={menuDisabled}
      >
        {menuItems}
      </SidebarListItemAction>
    </div>
  );
}

function SidebarListItemAction({
  title,
  running,
  unread,
  hasDraftPrompt,
  menuDisabled,
  children,
}: {
  title: string;
  running: boolean;
  unread: boolean;
  hasDraftPrompt: boolean;
  menuDisabled: boolean;
  children: ReactNode;
}) {
  const status = running
    ? {
        ariaLabel: `${title} is running`,
        tooltip: "Session is running",
        icon: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />,
      }
    : unread
      ? {
          ariaLabel: `${title} has unread messages`,
          tooltip: "Session has unread messages",
          icon: <Circle className="h-2.5 w-2.5 fill-unread text-unread" aria-hidden />,
        }
      : hasDraftPrompt
        ? {
            ariaLabel: `${title} has a draft prompt`,
            tooltip: "Session has a draft prompt",
            icon: <Pencil className="h-4 w-4 text-muted-foreground" aria-hidden />,
          }
        : null;

  if (status) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="status"
            className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center"
            aria-label={status.ariaLabel}
          >
            {status.icon}
          </div>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>{status.tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={menuDisabled}
          className="ml-2 h-8 w-8 shrink-0"
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

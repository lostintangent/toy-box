import type { MouseEvent, ReactNode } from "react";
import { Circle, Loader2, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import {
  SidebarListItemButton,
  SidebarListItemLayout,
  SidebarListItemMenu,
  type SidebarListItemProps,
} from "@/shared/components/sidebar/SidebarListItem";
import { useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { SessionPreview, useSessionPreview } from "../SessionPreview";

export function SidebarSessionItem({
  sessionId,
  previewDisabled = false,
  title,
  icon,
  time,
  badge,
  menuItems,
  menuDisabled = false,
  isActive = false,
  className,
  buttonClassName,
  titleClassName,
  disabled,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...props
}: SidebarListItemProps & {
  sessionId: string;
  previewDisabled?: boolean;
}) {
  const { running, unread, hasDraftPrompt } = useWorkspaceSessionActivity(sessionId);
  const preview = useSessionPreview(isActive || previewDisabled || disabled);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    preview.close();
    onClick?.(event);
  }

  function handleMouseEnter(event: MouseEvent<HTMLButtonElement>) {
    onMouseEnter?.(event);
    preview.onMouseEnter(event);
  }

  function handleMouseLeave(event: MouseEvent<HTMLButtonElement>) {
    onMouseLeave?.(event);
    preview.onMouseLeave();
  }

  return (
    <SidebarListItemLayout
      isActive={isActive}
      isHighlighted={preview.open}
      className={className}
      action={
        <SidebarSessionItemAction
          title={title}
          running={running}
          unread={unread && !isActive}
          hasDraftPrompt={hasDraftPrompt}
          menuDisabled={menuDisabled}
        >
          {menuItems}
        </SidebarSessionItemAction>
      }
    >
      <SessionPreview
        sessionId={sessionId}
        open={preview.open}
        onMouseEnter={preview.onMouseEnter}
        onMouseLeave={preview.onMouseLeave}
      >
        <SidebarListItemButton
          {...props}
          disabled={disabled}
          title={title}
          icon={icon}
          time={time}
          badge={badge}
          isActive={isActive}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          buttonClassName={buttonClassName}
          titleClassName={titleClassName}
        />
      </SessionPreview>
    </SidebarListItemLayout>
  );
}

function SidebarSessionItemAction({
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
    <SidebarListItemMenu title={title} disabled={menuDisabled}>
      {children}
    </SidebarListItemMenu>
  );
}

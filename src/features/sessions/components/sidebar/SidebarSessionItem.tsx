import type { MouseEvent, ReactNode } from "react";
import { Circle, CircleHelp, Loader2, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import {
  SidebarListItemButton,
  SidebarListItemLayout,
  SidebarListItemMenu,
  type SidebarListItemProps,
} from "@/shared/components/sidebar/SidebarListItem";
import { SessionPreview, useSessionPreview } from "../SessionPreview";

type SidebarSessionItemProps = SidebarListItemProps & {
  sessionId: string;
  activity: {
    running: boolean;
    waiting: boolean;
    unread: boolean;
    hasDraftPrompt: boolean;
  };
  previewDisabled?: boolean;
  titleContent?: ReactNode;
};

export function SidebarSessionItem({
  sessionId,
  activity,
  previewDisabled = false,
  title,
  titleContent,
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
}: SidebarSessionItemProps) {
  const { running, waiting, unread, hasDraftPrompt } = activity;
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
          waiting={waiting}
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
          titleContent={titleContent}
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
  waiting,
  unread,
  hasDraftPrompt,
  menuDisabled,
  children,
}: {
  title: string;
  running: boolean;
  waiting: boolean;
  unread: boolean;
  hasDraftPrompt: boolean;
  menuDisabled: boolean;
  children: ReactNode;
}) {
  const status = waiting
    ? {
        ariaLabel: `${title} is waiting for input`,
        tooltip: "Session is waiting for input",
        icon: <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden />,
      }
    : running
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

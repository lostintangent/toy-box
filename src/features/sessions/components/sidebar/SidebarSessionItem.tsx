import type { MouseEvent } from "react";
import { Circle, CircleHelp, Loader2, Pencil } from "lucide-react";
import {
  SidebarListItemAction,
  SidebarListItemButton,
  SidebarListItemLayout,
  type SidebarListItemProps,
  type SidebarListItemStatus,
} from "@/shared/components/sidebar/SidebarListItem";
import { SessionPreview, useSessionPreview } from "../SessionPreview";

type SidebarSessionItemProps = Omit<SidebarListItemProps, "status"> & {
  sessionId: string;
  activity: {
    running: boolean;
    waiting: boolean;
    unread: boolean;
    hasDraftPrompt: boolean;
  };
  previewDisabled?: boolean;
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
  const preview = useSessionPreview(isActive || previewDisabled || disabled);
  const status = getSessionListItemStatus(title, activity, isActive);

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
        <SidebarListItemAction title={title} status={status} menuDisabled={menuDisabled}>
          {menuItems}
        </SidebarListItemAction>
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

function getSessionListItemStatus(
  title: string,
  { running, waiting, unread, hasDraftPrompt }: SidebarSessionItemProps["activity"],
  isActive: boolean,
): SidebarListItemStatus | undefined {
  if (waiting) {
    return {
      ariaLabel: `${title} is waiting for input`,
      tooltip: "Session is waiting for input",
      icon: <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden />,
    };
  }
  if (running) {
    return {
      ariaLabel: `${title} is running`,
      tooltip: "Session is running",
      icon: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />,
    };
  }
  if (unread && !isActive) {
    return {
      ariaLabel: `${title} has unread messages`,
      tooltip: "Session has unread messages",
      icon: <Circle className="h-2.5 w-2.5 fill-unread text-unread" aria-hidden />,
    };
  }
  if (hasDraftPrompt) {
    return {
      ariaLabel: `${title} has a draft prompt`,
      tooltip: "Session has a draft prompt",
      icon: <Pencil className="h-4 w-4 text-muted-foreground" aria-hidden />,
    };
  }
}

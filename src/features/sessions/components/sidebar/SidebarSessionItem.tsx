import { useEffect, useState, type MouseEvent } from "react";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import {
  SidebarListItemAction,
  SidebarListItemButton,
  SidebarListItemLayout,
  type SidebarListItemProps,
} from "@/shared/sidebar/SidebarListItem";
import type { SidebarStatus } from "@/shared/sidebar/SidebarStatus";
import { SessionPreview, useSessionPreview } from "../SessionPreview";

type SidebarSessionItemProps = Omit<SidebarListItemProps, "status"> & {
  sessionId: string;
  activity: {
    running: boolean;
    waiting: boolean;
    background: boolean;
    unread: boolean;
  };
  previewDisabled?: boolean;
};

export function SidebarSessionItem({
  sessionId,
  activity,
  previewDisabled = false,
  title,
  titleContent,
  titleControl,
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
  const hasDraft = useWorkspaceSelector((workspace) =>
    Boolean(workspace.drafts[`session:${sessionId}`]?.text.trim()),
  );
  const justFinished = useJustFinished(activity.running || activity.waiting || activity.background);
  const status = getSessionListItemStatus(title, activity, hasDraft, isActive, justFinished);

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
          titleControl={titleControl}
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

/** True for a beat after a run ends, so finishing reads as a check before the unread dot. */
function useJustFinished(live: boolean): boolean {
  const [wasLive, setWasLive] = useState(live);
  const [justFinished, setJustFinished] = useState(false);
  if (live !== wasLive) {
    setWasLive(live);
    setJustFinished(!live);
  }

  useEffect(() => {
    if (!justFinished) return;
    const timer = setTimeout(() => setJustFinished(false), 3000);
    return () => clearTimeout(timer);
  }, [justFinished]);

  return justFinished;
}

function getSessionListItemStatus(
  title: string,
  { running, waiting, background, unread }: SidebarSessionItemProps["activity"],
  hasDraft: boolean,
  isActive: boolean,
  justFinished: boolean,
): SidebarStatus | undefined {
  if (waiting) {
    return {
      kind: "waiting",
      ariaLabel: `${title} is waiting for input`,
      tooltip: "Session is waiting for input",
    };
  }
  if (running) {
    return { kind: "running", ariaLabel: `${title} is running`, tooltip: "Session is running" };
  }
  if (background) {
    return {
      kind: "background",
      ariaLabel: `${title} has background tasks running`,
      tooltip: "Background tasks running",
    };
  }
  if (unread && !isActive) {
    return justFinished
      ? { kind: "finished", ariaLabel: `${title} finished`, tooltip: "Session finished" }
      : {
          kind: "unread",
          ariaLabel: `${title} has unread messages`,
          tooltip: "Session has unread messages",
        };
  }
  if (hasDraft) {
    return {
      kind: "draft",
      ariaLabel: `${title} has a draft prompt`,
      tooltip: "Session has a draft prompt",
    };
  }
}

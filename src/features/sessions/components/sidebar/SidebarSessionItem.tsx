import { useEffect, useState, type MouseEvent } from "react";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import {
  SidebarListItemAction,
  SidebarListItemButton,
  SidebarListItemLayout,
  type SidebarListItemProps,
} from "@/shared/sidebar/SidebarListItem";
import type { SidebarStatus } from "@/shared/sidebar/SidebarStatus";
import { isLiveActivity, sessionAttention, type SessionActivityStatus } from "../../model/activity";
import { SessionPreview, useSessionPreview } from "../SessionPreview";

type SidebarSessionItemProps = Omit<SidebarListItemProps, "status"> & {
  sessionId: string;
  status?: SessionActivityStatus;
  previewDisabled?: boolean;
};

export function SidebarSessionItem({
  sessionId,
  status,
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
  const justFinished = useJustFinished(status);
  const sidebarStatus = getSessionListItemStatus(title, status, hasDraft, isActive, justFinished);

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
        <SidebarListItemAction title={title} status={sidebarStatus} menuDisabled={menuDisabled}>
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

/** True for a beat after a run completes, even once it's read, so every client sees it finish.
 *  A stopped run ends idle rather than unread, so it isn't a completion. */
function useJustFinished(status: SessionActivityStatus | undefined): boolean {
  const live = isLiveActivity(status);
  const [wasLive, setWasLive] = useState(live);
  const [justFinished, setJustFinished] = useState(false);
  if (live !== wasLive) {
    setWasLive(live);
    setJustFinished(status === "unread");
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
  status: SessionActivityStatus | undefined,
  hasDraft: boolean,
  isActive: boolean,
  justFinished: boolean,
): SidebarStatus | undefined {
  const attention = sessionAttention(status, isActive);
  if (attention === "waiting") {
    return {
      kind: "waiting",
      ariaLabel: `${title} is waiting for input`,
      tooltip: "Session is waiting for input",
    };
  }
  if (status === "running") {
    return { kind: "running", ariaLabel: `${title} is running`, tooltip: "Session is running" };
  }
  if (status === "background") {
    return {
      kind: "background",
      ariaLabel: `${title} has background tasks running`,
      tooltip: "Background tasks running",
    };
  }
  if (justFinished) {
    return { kind: "finished", ariaLabel: `${title} finished`, tooltip: "Session finished" };
  }
  if (attention === "unread") {
    return {
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

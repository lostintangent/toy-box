import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRight, Pin } from "lucide-react";
import { useReducedMotionConfig } from "motion/react";
import { Typewriter } from "motion-plus/react";
import { DropdownMenuSeparator } from "@/shared/ui/dropdown-menu";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/utils";
import { RelativeTime } from "@/shared/ui/relative-time";
import { CommandMenuItem } from "@/shared/commands/CommandMenuItem";
import { useSessionActivity } from "../../useSessionActivity";
import { SidebarSessionItem } from "./SidebarSessionItem";
import type { Session } from "../../model";
import { getSessionLabel } from "../../model/label";
import { createSessionActions } from "../../commands";
import { SessionMetadataBadges } from "../location/SessionMetadataBadges";

type SessionListItemProps = {
  session: Session;
  onSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onPinToggle?: (sessionId: string) => void;
  isActive?: boolean;
  isPinned?: boolean;
  isWorktree?: boolean;
  childCount: number;
  renderChildren?: () => ReactNode;
};

export function SessionListItem({
  session,
  onSelect,
  onPinToggle,
  isActive = false,
  isPinned = false,
  isWorktree = false,
  childCount,
  renderChildren,
}: SessionListItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const childListId = useId();
  const isDraft = !session.provider;
  const activity = useSessionActivity(session.id);
  const sessionLabel = getSessionLabel(session);
  const isTitleLoading = !isDraft && !session.title && activity.running;

  const handleClick = (event: React.MouseEvent) => {
    onSelect(session.id, event.metaKey || event.ctrlKey);
  };

  const directory = session.context?.directory;

  return (
    <>
      <SidebarSessionItem
        sessionId={session.id}
        activity={activity}
        title={sessionLabel}
        titleContent={<SessionListItemTitle title={sessionLabel} loading={isTitleLoading} />}
        titleControl={
          renderChildren && (
            <Badge
              variant="count"
              render={<button type="button" />}
              className="cursor-pointer gap-0.5 text-foreground hover:bg-muted"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${childCount} child ${childCount === 1 ? "session" : "sessions"} for ${sessionLabel}`}
              aria-expanded={isExpanded}
              aria-controls={childListId}
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              {childCount}
              <ChevronRight
                aria-hidden
                className={cn(
                  "transition-transform duration-200 motion-reduce:transition-none",
                  isExpanded && "rotate-90",
                )}
              />
            </Badge>
          )
        }
        icon={isPinned ? <Pin className="size-3.5 shrink-0 text-accent" aria-hidden /> : undefined}
        time={
          !isDraft &&
          (activity.waiting ? (
            <span className="italic">Waiting for input</span>
          ) : activity.background ? (
            <span className="italic">Background tasks running</span>
          ) : activity.running && activity.since !== undefined ? (
            <RunningTime since={activity.since} />
          ) : (
            <RelativeTime date={session.updatedAt} />
          ))
        }
        badge={
          directory && (
            <SessionMetadataBadges
              cwd={directory}
              repository={session.context?.repository}
              gitRoot={session.context?.gitRoot}
              isWorktree={isWorktree}
            />
          )
        }
        menuItems={createSessionActions(
          session,
          onPinToggle && { isPinned, toggle: () => onPinToggle(session.id) },
        ).map((action) => (
          <Fragment key={action.id}>
            {action.destructive && <DropdownMenuSeparator />}
            <CommandMenuItem command={action} />
          </Fragment>
        ))}
        isActive={isActive}
        previewDisabled={isDraft}
        onClick={handleClick}
        titleClassName={isDraft || !session.title ? "italic text-muted-foreground" : "font-medium"}
      />
      {renderChildren && (
        <ul
          id={childListId}
          aria-label={`Child sessions of ${sessionLabel}`}
          hidden={!isExpanded}
          className={cn(
            "ml-4 mt-2 flex-col gap-2 border-l border-border pl-2",
            isExpanded ? "flex" : "hidden",
          )}
        >
          {isExpanded && renderChildren()}
        </ul>
      )}
    </>
  );
}

/** "Running 12s", "Running 12m", "Running 1h", "Running 1h 5m". Clock skew clamps to "Running 0s". */
export function formatRunningTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (seconds < 60) return `Running ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Running ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Running ${hours}h ${rest}m` : `Running ${hours}h`;
}

/** Re-renders on each boundary of the unit it displays: seconds for the first minute, then minutes. */
export function RunningTime({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const elapsed = Math.max(0, Date.now() - since);
    const unit = elapsed < 60_000 ? 1000 : 60_000;
    const timer = setTimeout(() => setNow(Date.now()), unit - (elapsed % unit));
    return () => clearTimeout(timer);
  }, [now, since]);
  return (
    <span className="italic" suppressHydrationWarning>
      {formatRunningTime(now - since)}
    </span>
  );
}

function SessionListItemTitle({ title, loading }: { title: string; loading: boolean }) {
  const reducedMotion = useReducedMotionConfig();
  const [initialTitle] = useState(title);
  const [hasTitleChanged, setHasTitleChanged] = useState(false);

  if (!hasTitleChanged && initialTitle !== title) {
    setHasTitleChanged(true);
  }

  if (loading) {
    return (
      <>
        <span className="sr-only">{title}</span>
        <span
          data-slot="skeleton"
          aria-hidden
          className="inline-block h-4 w-28 animate-pulse rounded-md bg-muted align-middle motion-reduce:animate-none"
        />
      </>
    );
  }

  if (!hasTitleChanged || reducedMotion) {
    return title;
  }

  return (
    <Typewriter speed="fast" replace="all" cursorStyle={{ display: "none" }}>
      {title}
    </Typewriter>
  );
}

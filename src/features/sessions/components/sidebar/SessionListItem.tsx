import { useEffect, useState } from "react";
import { FolderOpen, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useReducedMotionConfig } from "motion/react";
import { Typewriter } from "motion-plus/react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/shared/ui/dropdown-menu";
import { RelativeTime } from "@/shared/ui/relative-time";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import { useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { SidebarSessionItem } from "./SidebarSessionItem";
import type { Session } from "../../model";
import { sessionMutations } from "../../mutations";
import { SessionMetadataBadges } from "../location/SessionMetadataBadges";

type SessionListItemProps = {
  session: Session;
  onSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onPinToggle: () => void;
  onRename: () => void;
  onBrowseDirectory: (directory: string) => void;
  onDelete: () => void;
  isActive?: boolean;
  isPinned?: boolean;
  isWorktree?: boolean;
};

export function SessionListItem({
  session,
  onSelect,
  onPinToggle,
  onRename,
  onBrowseDirectory,
  onDelete,
  isActive = false,
  isPinned = false,
  isWorktree = false,
}: SessionListItemProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isDraft = !session.provider;
  const activity = useWorkspaceSessionActivity(session.id);
  const sessionLabel =
    session.title ||
    (isDraft && session.artifactPath
      ? session.artifactPath.toLowerCase().endsWith(".md")
        ? "New document"
        : "New whiteboard"
      : isDraft
        ? "Draft session"
        : "New session");
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
        icon={isPinned ? <Pin className="size-3.5 shrink-0 text-accent" aria-hidden /> : undefined}
        time={
          !isDraft &&
          (activity.waiting ? (
            <span className="italic">Waiting for input</span>
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
        menuItems={
          <>
            <DropdownMenuItem disabled={isDraft} onClick={onPinToggle}>
              {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              {isPinned ? "Unpin session" : "Pin session"}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isDraft} onClick={onRename}>
              <Pencil className="h-3.5 w-3.5" />
              Rename session
            </DropdownMenuItem>
            {directory && (
              <DropdownMenuItem onClick={() => onBrowseDirectory(directory)}>
                <FolderOpen className="h-3.5 w-3.5" />
                Browse files
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete session
            </DropdownMenuItem>
          </>
        }
        isActive={isActive}
        previewDisabled={isDraft}
        onClick={handleClick}
        titleClassName={isDraft || !session.title ? "italic text-muted-foreground" : "font-medium"}
      />
      {deleteOpen && (
        <DestructiveConfirmationDialog
          title="Delete session?"
          description="This will permanently delete this session and all its messages. This action cannot be undone."
          mutation={sessionMutations.deleteSession(session.id)}
          onSubmit={onDelete}
          onOpenChange={setDeleteOpen}
        />
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
function RunningTime({ since }: { since: number }) {
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

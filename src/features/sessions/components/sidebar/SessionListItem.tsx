import { useState } from "react";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
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

  const showBadges = Boolean(session.context?.directory);

  return (
    <>
      <SidebarSessionItem
        sessionId={session.id}
        activity={activity}
        title={sessionLabel}
        titleContent={<SessionListItemTitle title={sessionLabel} loading={isTitleLoading} />}
        icon={isPinned ? <Pin className="size-3.5 shrink-0 text-accent" aria-hidden /> : undefined}
        time={!isDraft && <RelativeTime date={session.updatedAt} />}
        badge={
          showBadges && (
            <SessionMetadataBadges
              cwd={session.context?.directory}
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

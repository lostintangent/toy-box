import { useState } from "react";
import { useViewport } from "@/hooks/browser/useViewport";
import { Circle, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SessionPreview,
  useSessionPreview,
} from "@/components/workspace/panes/session/SessionPreview";
import { SessionMetadataBadges } from "@/components/workspace/panes/session/location/SessionMetadataBadges";
import { RelativeTime } from "@/components/ui/relative-time";
import type { SessionMetadata } from "@/types";
import { useWorkspaceSessionActivity } from "@/hooks/workspace/state";
import { SidebarListItemMainButton, SidebarListItemShell } from "./SidebarListItemShell";
import { useSidebarScrollFade } from "./useSidebarScrollFade";

type SessionListItemProps = {
  session: SessionMetadata;
  onSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onRename?: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  isActive?: boolean;
  isWorktree?: boolean;
  isDraft?: boolean;
};

export function SessionListItem({
  session,
  onSelect,
  onRename,
  onDelete,
  isDeleting,
  isActive = false,
  isWorktree = false,
  isDraft = false,
}: SessionListItemProps) {
  const { hydrated, isMobile } = useViewport();
  const { running: isRunning, unread: hasUnreadActivity } = useWorkspaceSessionActivity(
    session.sessionId,
  );
  const isUnread = !isActive && hasUnreadActivity;
  const allowScrollIntoView = hydrated && !isMobile;
  const sessionLabel = session.summary || (isDraft ? "Draft session" : "New session");
  const { headlineRef, updateScrollFades } = useSidebarScrollFade(sessionLabel);

  const preview = useSessionPreview(isActive || isDraft);

  const handleClick = (event: React.MouseEvent) => {
    preview.close();
    onSelect(session.sessionId, event.metaKey || event.ctrlKey);
  };

  function scrollIntoViewRef(node: HTMLDivElement | null) {
    if (!node || !isActive) return;
    if (!allowScrollIntoView) return;
    node.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }
  const showBadges = Boolean(
    session.context?.repository || session.context?.gitRoot || session.context?.workingDirectory,
  );

  return (
    <SidebarListItemShell itemRef={scrollIntoViewRef} isActive={isActive} isHovered={preview.open}>
      <SessionPreview sessionId={session.sessionId} {...preview}>
        <SidebarListItemMainButton
          onClick={handleClick}
          onMouseEnter={preview.onMouseEnter}
          onMouseLeave={preview.onMouseLeave}
          aria-current={isActive ? "page" : undefined}
          headline={sessionLabel}
          headlineRef={headlineRef}
          onHeadlineScroll={updateScrollFades}
          onHeadlinePointerEnter={updateScrollFades}
          headlineClassName={session.summary ? "font-medium" : "italic text-muted-foreground"}
          secondary={
            (!isDraft || showBadges) && (
              <>
                {!isDraft && (
                  <div className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground/70">
                    <RelativeTime date={session.modifiedTime} />
                  </div>
                )}
                <SessionMetadataBadges
                  repository={session.context?.repository}
                  gitRoot={session.context?.gitRoot}
                  cwd={session.context?.workingDirectory}
                  isWorktree={isWorktree}
                />
              </>
            )
          }
        />
      </SessionPreview>

      <SessionAction
        isRunning={isRunning}
        isUnread={isUnread}
        isDeleting={isDeleting}
        sessionLabel={sessionLabel}
        onRename={onRename}
        onDelete={onDelete}
      />
    </SidebarListItemShell>
  );
}

function SessionAction({
  isRunning,
  isUnread,
  isDeleting,
  sessionLabel,
  onRename,
  onDelete,
}: {
  isRunning: boolean;
  isUnread: boolean;
  isDeleting: boolean;
  sessionLabel: string;
  onRename?: () => void;
  onDelete: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isRunning || isUnread) {
    return (
      <div
        className="ml-2 flex items-center justify-center w-8 h-8"
        aria-label={
          isRunning ? `${sessionLabel} is running` : `${sessionLabel} has unread activity`
        }
      >
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Circle className="h-2.5 w-2.5 fill-unread text-unread" />
        )}
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={isDeleting}
            className="ml-2 h-8 w-8 shrink-0"
            aria-label={`Actions for ${sessionLabel}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!onRename} onSelect={onRename}>
            <Pencil className="h-3.5 w-3.5" />
            Rename session
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isDeleting}
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this session and all its messages. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete();
                setDeleteOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useState } from "react";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SessionMetadataBadges } from "@/components/workspace/panes/session/location/SessionMetadataBadges";
import { RelativeTime } from "@/components/ui/relative-time";
import { DestructiveConfirmationDialog } from "@/components/sidebar/shell/DestructiveConfirmationDialog";
import { SidebarSessionItem } from "@/components/sidebar/shell/SidebarListItem";
import type { SessionMetadata } from "@/types";

type SessionListItemProps = {
  session: SessionMetadata;
  onSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onPinToggle?: () => void;
  onRename?: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  isActive?: boolean;
  isPinned?: boolean;
  isWorktree?: boolean;
  isDraft?: boolean;
};

export function SessionListItem({
  session,
  onSelect,
  onPinToggle,
  onRename,
  onDelete,
  isDeleting,
  isActive = false,
  isPinned = false,
  isWorktree = false,
  isDraft = false,
}: SessionListItemProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const sessionLabel = session.summary || (isDraft ? "Draft session" : "New session");

  const handleClick = (event: React.MouseEvent) => {
    onSelect(session.sessionId, event.metaKey || event.ctrlKey);
  };

  const showBadges = Boolean(
    session.context?.repository || session.context?.gitRoot || session.context?.workingDirectory,
  );

  return (
    <>
      <SidebarSessionItem
        sessionId={session.sessionId}
        title={sessionLabel}
        icon={
          isPinned ? <Pin className="size-3.5 shrink-0 text-user-accent" aria-hidden /> : undefined
        }
        time={!isDraft && <RelativeTime date={session.modifiedTime} />}
        badge={
          showBadges && (
            <SessionMetadataBadges
              repository={session.context?.repository}
              gitRoot={session.context?.gitRoot}
              cwd={session.context?.workingDirectory}
              isWorktree={isWorktree}
            />
          )
        }
        menuItems={
          <>
            {onPinToggle && (
              <DropdownMenuItem onSelect={onPinToggle}>
                {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                {isPinned ? "Unpin session" : "Pin session"}
              </DropdownMenuItem>
            )}
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
          </>
        }
        menuDisabled={isDeleting}
        isActive={isActive}
        previewDisabled={isDraft}
        onClick={handleClick}
        titleClassName={
          isDraft || !session.summary ? "italic text-muted-foreground" : "font-medium"
        }
      />
      <DestructiveConfirmationDialog
        open={deleteOpen}
        title="Delete session?"
        description="This will permanently delete this session and all its messages. This action cannot be undone."
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          onDelete();
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

import { useState } from "react";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/shared/components/ui/dropdown-menu";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { SidebarSessionItem } from "./SidebarSessionItem";
import type { SessionMetadata } from "../../model";
import { sessionMutations } from "../../mutations";
import { SessionMetadataBadges } from "../location/SessionMetadataBadges";

type SessionListItemProps = {
  session: SessionMetadata;
  onSelect: (sessionId: string, toggleInWorkspace: boolean) => void;
  onPinToggle?: () => void;
  onRename?: () => void;
  onDelete: () => void;
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
        isActive={isActive}
        previewDisabled={isDraft}
        onClick={handleClick}
        titleClassName={
          isDraft || !session.summary ? "italic text-muted-foreground" : "font-medium"
        }
      />
      {deleteOpen && (
        <DestructiveConfirmationDialog
          title="Delete session?"
          description="This will permanently delete this session and all its messages. This action cannot be undone."
          mutation={sessionMutations.deleteSession(session.sessionId)}
          onSubmit={onDelete}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}

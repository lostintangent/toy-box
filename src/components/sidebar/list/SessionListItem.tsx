import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SessionMetadataBadges } from "@/components/workspace/panes/session/location/SessionMetadataBadges";
import { RelativeTime } from "@/components/ui/relative-time";
import type { SessionMetadata } from "@/types";
import { SidebarListItem } from "../shell/SidebarListItem";

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
      <SidebarListItem
        sessionId={session.sessionId}
        title={sessionLabel}
        time={!isDraft && <RelativeTime date={session.modifiedTime} />}
        badges={
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
        titleClassName={session.summary ? "font-medium" : "italic text-muted-foreground"}
      />
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

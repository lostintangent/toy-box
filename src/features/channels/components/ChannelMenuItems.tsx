import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/shared/ui/dropdown-menu";

/** A Channel's actions, shared by every menu that offers them. */
export function ChannelMenuItems({
  onEdit,
  onBrowse,
  onDelete,
}: {
  onEdit: () => void;
  /** Opens the file browser at the working directory, when the Channel has one. */
  onBrowse?: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <DropdownMenuItem onClick={onEdit}>
        <Pencil /> Edit channel
      </DropdownMenuItem>
      {onBrowse && (
        <DropdownMenuItem onClick={onBrowse}>
          <FolderOpen /> Browse files
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 /> Delete channel
      </DropdownMenuItem>
    </>
  );
}

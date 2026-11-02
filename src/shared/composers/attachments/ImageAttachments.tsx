import { Loader2, Plus } from "lucide-react";
import { AttachmentGallery, attachmentPillClassName } from "@/shared/attachments/AttachmentGallery";
import type { Attachment } from "@/shared/attachments/model";
import { InputGroupAddon } from "@/shared/ui/input-group";
import { cn } from "@/shared/utils";

/** The composer's context row: this message's images, shown only while it has any. */
export function ImageAttachments({
  attachments,
  pendingCount,
  isDragging,
  onRemove,
}: {
  attachments: Attachment[];
  pendingCount: number;
  isDragging: boolean;
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0 && pendingCount === 0 && !isDragging) return null;

  return (
    <InputGroupAddon align="block-start" className="flex-wrap gap-1.5 px-2 pt-2 pb-0">
      <AttachmentGallery attachments={attachments} variant="pills" onRemove={onRemove} />
      {Array.from({ length: pendingCount }, (_, index) => (
        // eslint-disable-next-line react/no-array-index-key -- pending reads are interchangeable
        <span key={index} className={cn(attachmentPillClassName, "px-2")}>
          <Loader2 className="size-3.5 animate-spin" />
          Reading image
        </span>
      ))}
      {isDragging && (
        <span className={cn(attachmentPillClassName, "border-dashed border-ring px-2 text-ring")}>
          <Plus className="size-3.5" />
          Drop to attach
        </span>
      )}
    </InputGroupAddon>
  );
}

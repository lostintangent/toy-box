import { ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils";
import { toDataUrl, type Attachment } from "../model";

const thumbnailSizeClasses = {
  compact: "size-8",
  default: "size-12",
} as const;

export function AttachmentThumbnail({
  attachment,
  size = "default",
}: {
  attachment: Attachment;
  size?: keyof typeof thumbnailSizeClasses;
}) {
  const dataUrl = attachment.mimeType.startsWith("image/") ? toDataUrl(attachment) : undefined;
  const sizeClassName = thumbnailSizeClasses[size];

  if (dataUrl) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`Preview ${attachment.displayName}`}
            data-long-press-ignore
            className="shrink-0 overflow-hidden rounded-md border border-border transition-colors hover:border-primary"
          >
            <img
              src={dataUrl}
              alt={attachment.displayName}
              className={cn(sizeClassName, "object-cover")}
            />
          </button>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
          className="w-auto max-w-[90vw] border-0 bg-transparent p-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{attachment.displayName}</DialogTitle>
          <img
            src={dataUrl}
            alt={attachment.displayName}
            className="max-h-[85vh] max-w-[90vw] rounded-lg"
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div
      role="img"
      aria-label={attachment.displayName}
      className={cn(
        sizeClassName,
        "flex shrink-0 items-center justify-center rounded-md border border-border bg-muted",
      )}
    >
      <ImageIcon className="size-5 text-muted-foreground" />
    </div>
  );
}

import { ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { RelativeTime } from "@/components/ui/relative-time";
import type { Attachment, UserMessage as UserMessageType } from "@/types";
import { toDataUrl } from "@/types";

export function UserMessage({ message }: { message: UserMessageType }) {
  const hasAttachments = message.attachments && message.attachments?.length > 0;

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Message content */}
      <div className="max-w-full @md:max-w-[80%] rounded-lg px-4 py-2 bg-primary text-primary-foreground">
        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
      </div>
      {/* Timestamp */}
      {message.timestamp && (
        <RelativeTime className="text-xs text-muted-foreground" date={message.timestamp} />
      )}
      {/* Attachment thumbnails */}
      {hasAttachments && (
        <div className="flex gap-1 flex-wrap justify-end max-w-full @md:max-w-[80%]">
          {message.attachments!.map((attachment) => (
            <AttachmentThumbnail key={attachment.displayName} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentThumbnail({ attachment }: { attachment: Attachment }) {
  const dataUrl = toDataUrl(attachment);
  if (dataUrl) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button className="rounded-md overflow-hidden border border-border hover:border-primary transition-colors">
            <img src={dataUrl} alt={attachment.displayName} className="h-12 w-12 object-cover" />
          </button>
        </DialogTrigger>
        <DialogContent
          className="w-auto max-w-[90vw] sm:max-w-[90vw] p-0 border-0 bg-transparent"
          showCloseButton={false}
        >
          <img
            src={dataUrl}
            alt={attachment.displayName}
            className="max-h-[85vh] max-w-[90vw] rounded-lg"
          />
        </DialogContent>
      </Dialog>
    );
  }

  // Fallback for non-image or missing file
  return (
    <div className="shrink-0 h-12 w-12 rounded-md bg-muted flex items-center justify-center border border-border">
      <ImageIcon className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

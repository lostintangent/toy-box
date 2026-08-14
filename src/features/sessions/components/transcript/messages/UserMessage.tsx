import { RelativeTime } from "@/shared/components/ui/relative-time";
import type { UserMessage as UserMessageType } from "../../../model";
import { AttachmentThumbnail } from "../../AttachmentThumbnail";

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

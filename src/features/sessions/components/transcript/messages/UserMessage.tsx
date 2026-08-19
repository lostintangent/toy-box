import { useState } from "react";
import { Undo2 } from "lucide-react";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { useWorkspaceSessionRunning } from "@workspace/hooks/state";
import type { UserMessage as UserMessageType } from "../../../model";
import { sessionMutations } from "../../../mutations";
import { AttachmentThumbnail } from "../../AttachmentThumbnail";
import { useCurrentSession } from "../../CurrentSessionContext";

export function UserMessage({ message }: { message: UserMessageType }) {
  const attachments = message.attachments ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Message content */}
      <div className="max-w-full @md:max-w-[80%] rounded-lg px-4 py-2 bg-primary text-primary-foreground">
        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
      </div>
      {/* Timestamp */}
      {message.timestamp && (
        <div className="flex min-h-6 items-center gap-1">
          <RewindControl timestamp={message.timestamp} />
          <RelativeTime className="text-xs text-muted-foreground" date={message.timestamp} />
        </div>
      )}
      {/* Attachment thumbnails */}
      {attachments.length > 0 && (
        <div className="flex gap-1 flex-wrap justify-end max-w-full @md:max-w-[80%]">
          {attachments.map((attachment) => (
            <AttachmentThumbnail key={attachment.displayName} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}

function RewindControl({ timestamp }: { timestamp: string }) {
  const { sessionId, mode } = useCurrentSession();
  const isSessionRunning = useWorkspaceSessionRunning(sessionId);
  const [open, setOpen] = useState(false);

  if (mode === "passive" || isSessionRunning) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Rewind to before this message"
            onClick={() => setOpen(true)}
          >
            <Undo2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={4}>Rewind to before this message</TooltipContent>
      </Tooltip>
      {open && (
        <DestructiveConfirmationDialog
          title="Rewind conversation?"
          description="This removes this message and every message after it. Files are not changed. This action cannot be undone."
          confirmLabel="Rewind"
          pendingLabel="Rewinding..."
          mutation={sessionMutations.rewindSession(sessionId, timestamp)}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

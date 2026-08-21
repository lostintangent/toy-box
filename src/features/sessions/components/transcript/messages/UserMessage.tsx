import { useState } from "react";
import { Copy, Undo2 } from "lucide-react";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { isWorkspaceSessionLive } from "@workspace/model/state/reducer";
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
      {/* Message actions and timestamp */}
      <div className="flex min-h-6 items-center gap-1">
        {message.timestamp && <RewindControl timestamp={message.timestamp} />}
        <CopyControl content={message.content} />
        {message.timestamp && (
          <RelativeTime className="text-xs text-muted-foreground" date={message.timestamp} />
        )}
      </div>
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

function CopyControl({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Copy message"
          onClick={() => void navigator.clipboard.writeText(content)}
        >
          <Copy aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>Copy message</TooltipContent>
    </Tooltip>
  );
}

function RewindControl({ timestamp }: { timestamp: string }) {
  const { sessionId, mode } = useCurrentSession();
  const isSessionLive = useWorkspaceSelector((workspace) =>
    isWorkspaceSessionLive(workspace.sessionStates[sessionId]?.status),
  );
  const [open, setOpen] = useState(false);

  if (mode === "passive" || isSessionLive) return null;

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
      <Separator orientation="vertical" className="h-4!" />
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

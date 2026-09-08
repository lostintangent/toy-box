import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { AgentMention } from "@agents/components/AgentMention";
import { Button } from "@/shared/components/ui/button";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { Separator } from "@/shared/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import type { UserMessage as UserMessageType } from "../../../model";
import { AttachmentGallery } from "../../AttachmentGallery";

export function UserMessage({
  message,
  extraActions,
}: {
  message: Pick<UserMessageType, "content" | "attachments" | "timestamp">;
  extraActions?: ReactNode;
}) {
  const attachments = message.attachments ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      {message.content && (
        <div className="max-w-full @md:max-w-[80%] rounded-lg bg-primary px-3 py-2.5 text-primary-foreground">
          <AgentMention content={message.content} onAccent />
        </div>
      )}
      <div className="flex min-h-6 items-center gap-1">
        {extraActions}
        {extraActions && <Separator orientation="vertical" className="h-4!" />}
        <CopyControl content={message.content} />
        {message.timestamp && (
          <RelativeTime className="text-xs text-muted-foreground" date={message.timestamp} />
        )}
      </div>
      {attachments.length > 0 && (
        <div className="flex gap-1 flex-wrap justify-end max-w-full @md:max-w-[80%]">
          <AttachmentGallery attachments={attachments} />
        </div>
      )}
    </div>
  );
}

function CopyControl({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Copy message"
            onClick={() => void navigator.clipboard.writeText(content)}
          >
            <Copy aria-hidden />
          </Button>
        }
      />
      <TooltipContent sideOffset={4}>Copy message</TooltipContent>
    </Tooltip>
  );
}

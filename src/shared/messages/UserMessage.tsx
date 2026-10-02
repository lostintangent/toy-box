import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { Markdown } from "@/shared/ui/markdown";
import { Button } from "@/shared/ui/button";
import { RelativeTime } from "@/shared/ui/relative-time";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { AttachmentGallery } from "@/shared/attachments/AttachmentGallery";
import type { Attachment } from "@/shared/attachments/model";

export function UserMessage({
  message,
  extraActions,
  time,
  children,
}: {
  message: {
    content: string;
    timestamp?: string;
    attachments?: (Attachment | { label: string; src: string })[];
  };
  extraActions?: ReactNode;
  /** Replaces the relative timestamp, such as in a timeline already divided by day. */
  time?: ReactNode;
  children?: ReactNode;
}) {
  const attachments = message.attachments ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      {message.content && (
        <div className="max-w-full @md:max-w-[80%] rounded-lg bg-primary px-3 py-2.5 text-sm text-primary-foreground [&_[data-streamdown=link]]:text-primary-foreground [&_[data-streamdown=inline-code]]:bg-primary-foreground/15">
          {children ?? <Markdown preserveLineBreaks>{message.content}</Markdown>}
        </div>
      )}
      <div className="flex min-h-6 items-center gap-1">
        {extraActions}
        {extraActions && <Separator orientation="vertical" className="h-4!" />}
        <CopyControl content={message.content} />
        {time ??
          (message.timestamp && (
            <RelativeTime className="text-xs text-muted-foreground" date={message.timestamp} />
          ))}
      </div>
      {attachments.length > 0 && (
        <div className="flex gap-1 flex-wrap justify-end max-w-full @md:max-w-[80%]">
          <AttachmentGallery attachments={attachments} />
        </div>
      )}
    </div>
  );
}

export function CopyControl({ content }: { content: string }) {
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

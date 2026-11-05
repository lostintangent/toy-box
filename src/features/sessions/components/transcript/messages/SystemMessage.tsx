import type { ReactNode } from "react";
import { MessageSquare, Pencil } from "lucide-react";
import { Markdown } from "@/shared/ui/markdown";
import { RelativeTime } from "@/shared/ui/relative-time";
import { cn } from "@/shared/utils";
import type { SystemMessage as SystemMessageValue } from "../../../model";
import { systemMessageLabel } from "../../../model/systemMessages";

export function SystemMessage({ message }: { message: SystemMessageValue }) {
  const systemMessage = message.content;

  if (systemMessage.type === "file_edited") {
    return (
      <SystemMessageCard
        align="right"
        header={
          <>
            <Pencil className="size-3.5 shrink-0" />
            <span className="truncate text-sm font-normal italic">
              {systemMessageLabel(systemMessage)}
            </span>
          </>
        }
        timestamp={message.timestamp}
      />
    );
  }

  return (
    <SystemMessageCard
      header={
        <>
          <MessageSquare className="size-4" />
          <span>{systemMessageLabel(systemMessage)}</span>
        </>
      }
      timestamp={message.timestamp}
    >
      {systemMessage.type === "channel_lead_message" && (
        <Markdown preserveLineBreaks className="mt-2 min-w-0 break-words text-sm">
          {systemMessage.content}
        </Markdown>
      )}
    </SystemMessageCard>
  );
}

function SystemMessageCard({
  header,
  timestamp,
  align = "left",
  children,
}: {
  header: ReactNode;
  timestamp?: string;
  align?: "left" | "right";
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", align === "right" ? "items-end" : "items-start")}>
      <div className="max-w-full rounded-lg border bg-secondary-background px-3 py-2.5 @md:max-w-[80%]">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          {header}
        </div>
        {children}
      </div>
      {timestamp && <RelativeTime className="text-xs text-muted-foreground" date={timestamp} />}
    </div>
  );
}

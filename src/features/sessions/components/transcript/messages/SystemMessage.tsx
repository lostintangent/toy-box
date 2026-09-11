import type { ReactNode } from "react";
import { GitFork, MessageSquare, Pencil } from "lucide-react";
import { Streamdown } from "streamdown";
import { AgentAvatar } from "@agents/components/AgentAvatar";
import { RelativeTime } from "@/shared/components/ui/relative-time";
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
        systemMessage.type === "agent_response" ? (
          <>
            <AgentAvatar
              name={systemMessage.name}
              avatar={systemMessage.avatar}
              className="size-6"
            />
            <span className="text-sm">{systemMessage.name}</span>
            {systemMessage.executionMode === "worktree" && (
              <span className="inline-flex items-center gap-1 font-normal text-cyan-700 dark:text-cyan-300">
                <GitFork className="size-3" /> worktree
              </span>
            )}
          </>
        ) : (
          <>
            <MessageSquare className="size-4" />
            <span>{systemMessageLabel(systemMessage)}</span>
          </>
        )
      }
      timestamp={message.timestamp}
    >
      {systemMessage.type !== "channel_message" && (
        <Streamdown className="text-sm [&_p]:my-2 [&_pre]:my-2 [&_ul]:my-2 [&_ol]:my-2">
          {systemMessage.content}
        </Streamdown>
      )}
    </SystemMessageCard>
  );
}

function SystemMessageCard({
  header,
  timestamp,
  children,
  align = "left",
}: {
  header: ReactNode;
  timestamp?: string;
  children?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("flex flex-col gap-2", align === "right" ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-full rounded-lg border bg-secondary-background px-3 @md:max-w-[80%]",
          children ? "py-3" : "py-2.5",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 text-xs font-semibold text-muted-foreground",
            children && "mb-2",
          )}
        >
          {header}
        </div>
        {children}
      </div>
      {timestamp && <RelativeTime className="text-xs text-muted-foreground" date={timestamp} />}
    </div>
  );
}

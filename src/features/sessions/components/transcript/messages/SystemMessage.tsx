import type { ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MessageSquare, Pencil } from "lucide-react";
import { Streamdown } from "streamdown";
import { AgentAvatar } from "@agents/components/AgentAvatar";
import { agentQueries } from "@agents/queries";
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
          <AgentResponseHeader agentId={systemMessage.agentId} />
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

function AgentResponseHeader({ agentId }: { agentId: string }) {
  const { data: agents } = useSuspenseQuery(agentQueries.list());
  const agent = agents.find(({ id }) => id === agentId);
  const name = agent?.name ?? "Deleted agent";

  return (
    <>
      <AgentAvatar name={agent?.name ?? "?"} avatar={agent?.avatar} className="size-6" />
      <span className={cn("text-sm", !agent && "italic")}>{name}</span>
    </>
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

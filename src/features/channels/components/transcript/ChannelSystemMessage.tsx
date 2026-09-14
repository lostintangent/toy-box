import type { ReactNode } from "react";
import { FileUp, UserMinus, UserPlus } from "lucide-react";
import type { Agent } from "@agents/model";
import { isChannelSystemMessage } from "@channels/model";
import type { ChannelMessage } from "@channels/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";

const DELETED_AGENT_LABEL = "Deleted agent";

export function ChannelSystemMessageView({
  messages,
  agents,
}: {
  messages: ChannelMessage[];
  agents: Agent[];
}) {
  const { toggleFile } = useWorkspaceSurface();
  const message = messages[0]!;
  if (!isChannelSystemMessage(message)) return null;

  const systemMessage = message.content;
  let icon: ReactNode;
  let content: ReactNode;
  let tooltip: string | undefined;

  switch (systemMessage.type) {
    case "member_joined":
    case "member_left": {
      const names = membershipAgentNames(messages, agents);
      const joined = systemMessage.type === "member_joined";
      icon = joined ? (
        <UserPlus className="size-3.5 shrink-0" />
      ) : (
        <UserMinus className="size-3.5 shrink-0" />
      );
      content = formatMembershipChange(names, joined);
      tooltip = names.length > 1 ? names.join(", ") : undefined;
      break;
    }
    case "artifact_shared": {
      const actor = systemMessage.actor;
      const actorName =
        actor.type === "user"
          ? "You"
          : (agents.find(({ id }) => id === actor.agentId)?.name ?? DELETED_AGENT_LABEL);
      icon = <FileUp className="size-3.5 shrink-0" />;
      content = (
        <>
          {actorName} shared{" "}
          <button
            type="button"
            title={systemMessage.artifact.file.path}
            className="font-medium text-foreground underline decoration-current/40 underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => toggleFile?.(systemMessage.artifact.file)}
          >
            {systemMessage.artifact.title}
          </button>
        </>
      );
      break;
    }
  }

  const body = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {icon}
      <span className="min-w-0">{content}</span>
    </span>
  );

  return (
    <div className="flex w-full items-center justify-center gap-2 text-center text-xs italic text-muted-foreground">
      <span className="h-px min-w-4 flex-1 bg-border" />
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            {body}
          </TooltipTrigger>
          <TooltipContent sideOffset={4} className="max-w-72">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        body
      )}
      <span className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}

function membershipAgentNames(
  messages: readonly ChannelMessage[],
  agents: readonly Agent[],
): string[] {
  return messages.flatMap((message) => {
    if (!isChannelSystemMessage(message)) return [];
    const content = message.content;
    if (content.type !== "member_joined" && content.type !== "member_left") {
      return [];
    }
    return [agents.find(({ id }) => id === content.member.agentId)?.name ?? DELETED_AGENT_LABEL];
  });
}

function formatMembershipChange(names: readonly string[], joined: boolean): string {
  const name = names[0] ?? DELETED_AGENT_LABEL;
  const action = joined ? "joined" : "left";
  if (names.length === 1) return `${name} ${action} the channel`;
  const others = names.length - 1;
  return `${name} and ${others} ${others === 1 ? "other" : "others"} ${action} the channel`;
}

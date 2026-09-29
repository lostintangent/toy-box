import type { ReactNode } from "react";
import { FileUp, Pencil, UserMinus, UserPlus } from "lucide-react";
import { DELETED_AGENT_NAME, type ChannelSystemMessage } from "@channels/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { useChannelPane } from "../ChannelPaneContext";

/** One system message, or a run of membership changes or one agent's artifact shares, merged. */
export function SystemMessageGroup({ messages }: { messages: readonly ChannelSystemMessage[] }) {
  const { agents } = useChannelPane();
  const { revealFile } = useWorkspaceSurface();
  const systemMessage = messages[0]!.content;
  let icon: ReactNode = <Pencil className="size-3.5 shrink-0" />;
  let content: ReactNode;
  let tooltip: string | undefined;

  switch (systemMessage.type) {
    case "channel_marked_done":
      icon = <DoneIndicator className="size-4 shrink-0" />;
      content = "Channel marked as done";
      break;
    case "channel_renamed":
      content = (
        <>
          Channel was renamed to{" "}
          <span className="font-medium text-foreground">{systemMessage.name}</span>
        </>
      );
      break;
    case "channel_purpose_changed": {
      const { purpose } = systemMessage;
      const text = purpose?.replace(/\s+/g, " ");
      const preview = text && text.length > 120 ? `${text.slice(0, 117)}...` : text;
      content =
        purpose === null ? (
          "The channel’s purpose has been cleared"
        ) : (
          <>
            The channel’s purpose has been updated to{" "}
            <span className="font-medium text-foreground" title={purpose}>
              “{preview}”
            </span>
          </>
        );
      break;
    }
    case "channel_directory_changed": {
      const { directory } = systemMessage;
      const preview =
        directory && directory.length > 120 ? `...${directory.slice(-117)}` : directory;
      content =
        directory === null ? (
          "The working directory has been cleared"
        ) : (
          <>
            The working directory has been changed to{" "}
            <span className="font-medium text-foreground" title={directory}>
              {preview}
            </span>
          </>
        );
      break;
    }
    case "member_joined":
    case "member_left": {
      const names = membershipAgentNames(messages);
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
          : (agents.find(({ id }) => id === actor.agentId)?.name ?? DELETED_AGENT_NAME);
      const artifacts = messages.flatMap(({ id, content }) =>
        content.type === "artifact_shared" ? [{ id, ...content.artifact }] : [],
      );
      icon = <FileUp className="size-3.5 shrink-0" />;
      content = (
        <>
          {actorName} shared{" "}
          {artifacts.map((artifact, index) => (
            <span key={artifact.id}>
              {index > 0 &&
                (index === artifacts.length - 1
                  ? artifacts.length > 2
                    ? ", and "
                    : " and "
                  : ", ")}
              <button
                type="button"
                title={artifact.file.path}
                className="font-medium text-foreground underline decoration-current/40 underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => revealFile?.(artifact.file)}
              >
                {artifact.title}
              </button>
            </span>
          ))}
        </>
      );
      break;
    }
  }

  // The icon sits in the avatar column, so events read as part of the conversation.
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex w-8 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0">{content}</span>
    </span>
  );

  return (
    <div className="flex text-xs text-muted-foreground">
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
    </div>
  );
}

function membershipAgentNames(messages: readonly ChannelSystemMessage[]): string[] {
  return messages.flatMap(({ content }) =>
    content.type === "member_joined" || content.type === "member_left" ? [content.member.name] : [],
  );
}

function formatMembershipChange(names: readonly string[], joined: boolean): string {
  const name = names[0] ?? DELETED_AGENT_NAME;
  const action = joined ? "joined" : "left";
  if (names.length === 1) return `${name} ${action} the channel`;
  const others = names.length - 1;
  return `${name} and ${others} ${others === 1 ? "other" : "others"} ${action} the channel`;
}

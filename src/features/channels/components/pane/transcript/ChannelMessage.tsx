import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentMention } from "@channels/components/agents/AgentMention";
import { isChannelSystemMessage } from "@channels/model";
import type { ChannelAgent, ChannelMessage, ChannelReaction } from "@channels/model";
import { AttachmentGallery } from "@sessions/components/AttachmentGallery";
import { UserMessage } from "@sessions/components/transcript/messages/UserMessage";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import { ChannelSystemMessageView } from "./ChannelSystemMessage";

const DELETED_AGENT_LABEL = "Deleted agent";
type DisplayedReaction = {
  agentId: string;
  reaction: ChannelReaction["reaction"] | "looking" | "working";
};

export function ChannelMessageView({
  messages,
  agents,
}: {
  messages: ChannelMessage[];
  agents: ChannelAgent[];
}) {
  const message = messages[0]!;
  if (isChannelSystemMessage(message)) {
    return <ChannelSystemMessageView messages={messages} agents={agents} />;
  }

  const reactions: DisplayedReaction[] = [...(message.reactions ?? [])];
  for (const agent of agents) {
    if (agent.status?.state !== "working") continue;
    if (agent.status.lookingAt === message.sequence) {
      reactions.push({ agentId: agent.id, reaction: "looking" });
    }
    if (agent.status.workingOn === message.sequence) {
      reactions.push({ agentId: agent.id, reaction: "working" });
    }
  }

  const sender = message.sender;
  if (sender.type === "user") {
    return (
      <UserMessage
        message={message}
        extraActions={
          reactions.length ? (
            <div className="mr-1">
              <ChannelMessageReactions reactions={reactions} agents={agents} />
            </div>
          ) : undefined
        }
      >
        <AgentMention content={message.content} onAccent />
      </UserMessage>
    );
  }

  const agent = agents.find(({ id }) => id === sender.agentId);
  const agentName = agent?.name ?? DELETED_AGENT_LABEL;
  const attachments = message.attachments ?? [];
  return (
    <article className="flex gap-3">
      <AgentAvatar name={agent?.name ?? "?"} avatar={agent?.avatar} />
      <div className="min-w-0 max-w-full @md:max-w-[80%]">
        <div className="mb-1 flex items-center gap-2">
          <span className={cn("text-xs font-semibold", !agent && "italic")}>{agentName}</span>
          <RelativeTime className="text-2xs text-muted-foreground" date={message.timestamp} />
        </div>
        {message.content && (
          <div className="rounded-xl border bg-secondary-background px-3.5 py-2.5 text-left">
            <AgentMention content={message.content} />
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <AttachmentGallery attachments={attachments} />
          </div>
        )}
        {reactions.length ? (
          <div className="mt-2">
            <ChannelMessageReactions reactions={reactions} agents={agents} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

const REACTION_PRESENTATION = {
  looking: { emoji: "👀", label: "Looking" },
  working: { emoji: "🏃", label: "In progress" },
  done: { emoji: "✅", label: "Done" },
  agree: { emoji: "👍", label: "Agreed" },
  celebrate: { emoji: "🎉", label: "Celebrated" },
  love: { emoji: "❤️", label: "Loved this" },
  laugh: { emoji: "😂", label: "Laughed" },
} satisfies Record<DisplayedReaction["reaction"], { emoji: string; label: string }>;

function ChannelMessageReactions({
  reactions,
  agents,
}: {
  reactions: DisplayedReaction[];
  agents: ChannelAgent[];
}) {
  const groups = new Map<DisplayedReaction["reaction"], string[]>();
  for (const reaction of reactions) {
    const names = groups.get(reaction.reaction) ?? [];
    names.push(agents.find(({ id }) => id === reaction.agentId)?.name ?? DELETED_AGENT_LABEL);
    groups.set(reaction.reaction, names);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {[...groups].map(([reaction, names]) => {
        const presentation = REACTION_PRESENTATION[reaction];
        return (
          <Tooltip key={reaction}>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  aria-label={`${presentation.label}: ${names.join(", ")}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-2xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <span aria-hidden>{presentation.emoji}</span>
              {names.length > 1 && <span className="tabular-nums">{names.length}</span>}
            </TooltipTrigger>
            <TooltipContent sideOffset={4} className="max-w-72">
              {names.join(", ")}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

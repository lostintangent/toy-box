import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { DELETED_AGENT_NAME } from "@channels/model";
import type { ChannelMessageReaction } from "@channels/model/reactions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useChannelPane } from "../ChannelPaneContext";

const REACTION_PRESENTATION = {
  looking: { emoji: "👀", label: "Looking" },
  working: { emoji: "🏃", label: "In progress" },
  done: { emoji: "✅", label: "Done" },
  agree: { emoji: "👍", label: "Agreed" },
  celebrate: { emoji: "🎉", label: "Celebrated" },
  love: { emoji: "❤️", label: "Loved this" },
  laugh: { emoji: "😂", label: "Laughed" },
} satisfies Record<ChannelMessageReaction["reaction"], { emoji: string; label: string }>;

// A few reactors show by face; the rest count, and every name is a hover away.
const VISIBLE_REACTORS = 3;

export function ChannelReactions({ reactions }: { reactions: readonly ChannelMessageReaction[] }) {
  const { agents } = useChannelPane();
  const groups = new Map<ChannelMessageReaction["reaction"], ChannelMessageReaction[]>();
  for (const reaction of reactions) {
    groups.set(reaction.reaction, [...(groups.get(reaction.reaction) ?? []), reaction]);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {[...groups].map(([reaction, entries]) => {
        const presentation = REACTION_PRESENTATION[reaction];
        const reactors = entries.map(({ agentId }) => ({
          agentId,
          agent: agents.find(({ id }) => id === agentId),
        }));
        const names = reactors.map(({ agent }) => agent?.name ?? DELETED_AGENT_NAME).join(", ");
        return (
          <Tooltip key={reaction}>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  aria-label={`${presentation.label}: ${names}`}
                  className="inline-flex h-5.5 items-center gap-1 rounded-full border bg-muted/40 pr-1 pl-1.5 text-2xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <span aria-hidden>{presentation.emoji}</span>
              <span className="flex gap-0.5">
                {reactors.slice(0, VISIBLE_REACTORS).map(({ agentId, agent }) => (
                  <AgentAvatar
                    key={agentId}
                    name={agent?.name ?? "?"}
                    avatar={agent?.avatar}
                    className="size-3.5"
                  />
                ))}
              </span>
              {reactors.length > VISIBLE_REACTORS && (
                <span className="tabular-nums">+{reactors.length - VISIBLE_REACTORS}</span>
              )}
            </TooltipTrigger>
            <TooltipContent sideOffset={4} className="max-w-72">
              {names}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

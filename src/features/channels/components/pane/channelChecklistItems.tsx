import { UserRoundX } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { DELETED_AGENT_NAME, type ChannelAgent, type ChannelChecklistItem } from "@channels/model";
import type { ChecklistItem } from "@/shared/ui/checklist";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/** A Channel checklist as shared checklist items, each showing its owner's avatar. */
export function channelChecklistItems(
  checklist: readonly ChannelChecklistItem[],
  owners: readonly ChannelAgent[],
): ChecklistItem[] {
  return checklist.map((item) => ({
    id: `${item.title}:${item.ownerId ?? ""}`,
    title: item.title,
    status: item.status,
    detail: item.ownerId ? (
      <ChecklistOwner owner={owners.find(({ id }) => id === item.ownerId)} />
    ) : undefined,
    children: item.children && channelChecklistItems(item.children, owners),
  }));
}

function ChecklistOwner({ owner }: { owner?: ChannelAgent }) {
  const name = owner?.name ?? DELETED_AGENT_NAME;
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label={name} className="inline-flex" />}>
        {owner ? (
          <AgentAvatar name={owner.name} avatar={owner.avatar} className="size-4" />
        ) : (
          <UserRoundX className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>{name}</TooltipContent>
    </Tooltip>
  );
}

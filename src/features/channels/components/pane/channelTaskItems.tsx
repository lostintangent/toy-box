import { UserRoundX } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { DELETED_AGENT_NAME, type ChannelAgent, type ChannelTask } from "@channels/model";
import type { ChecklistItem } from "@/shared/ui/checklist";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/** A Channel's tasks as shared checklist items, each showing its owner's avatar. */
export function channelTaskItems(
  tasks: readonly ChannelTask[],
  owners: readonly ChannelAgent[],
): ChecklistItem[] {
  return tasks.map((task) => ({
    id: `${task.title}:${task.ownerId ?? ""}`,
    title: task.title,
    status: task.status,
    detail: task.ownerId ? (
      <TaskOwner owner={owners.find(({ id }) => id === task.ownerId)} />
    ) : undefined,
    children: task.children && channelTaskItems(task.children, owners),
  }));
}

function TaskOwner({ owner }: { owner?: ChannelAgent }) {
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

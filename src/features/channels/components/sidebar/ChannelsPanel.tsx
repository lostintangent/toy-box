import type { CSSProperties } from "react";
import { Hash, Plus } from "lucide-react";
import { WorkingAgents } from "@channels/components/agents/WorkingAgents";
import { channelCommands } from "@channels/commands";
import { channelAttention, createChannelPane } from "@channels/model";
import { useChannels } from "@channels/useChannels";
import { CommandButton } from "@/shared/commands/CommandButton";
import { CommandMenuItems } from "@/shared/commands/CommandMenuItem";
import { SidebarListItem } from "@/shared/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { RelativeTime } from "@/shared/ui/relative-time";
import { SessionMetadataBadges } from "@sessions/components/location/SessionMetadataBadges";
import { useWorkspaceRoots } from "@workspace/hooks/layout/roots";
import { channelSidebarStatus } from "./status";

/** The channel icon's identity fill, cyan in both appearances. */
const CHANNEL_ICON_STYLE: CSSProperties & { "--identity": string } = { "--identity": "#0891b2" };

export function ChannelsPanel({
  isExpanded,
  onExpandedChange,
}: {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { selectRoot, isOpen } = useWorkspaceRoots();
  const channels = useChannels();

  const rows = channels.map((entry) => {
    const attention = channelAttention(entry.channel, isOpen(createChannelPane(entry.channel.id)));
    return { ...entry, status: attention && channelSidebarStatus(entry.channel, attention) };
  });

  return (
    <SidebarPanel
      title="Channels"
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      activity={{
        waiting: rows.some(({ status }) => status?.kind === "waiting"),
        finished: rows.some(({ status }) => status?.kind === "finished"),
        unread: rows.some(({ status }) => status?.kind === "unread"),
        running: channels.some(({ agents }) => agents.some(({ isWorking }) => isWorking)),
      }}
      action={
        <CommandButton command="channel.create" size="icon" variant="ghost" className="h-6 w-6">
          <Plus className="h-4 w-4" />
        </CommandButton>
      }
      emptyMessage="Channels keep a team of agents working together."
    >
      {rows.map(({ channel, agents, status }) => {
        const { directory } = channel;

        return (
          <SidebarListItem
            key={channel.id}
            title={channel.name}
            titleContent={
              <span className="flex items-center gap-3">
                <span>{channel.name}</span>
                <WorkingAgents
                  working={agents.filter(({ isWorking }) => isWorking).map((agent) => ({ agent }))}
                  variant="compact"
                />
              </span>
            }
            icon={
              <span
                className="identity-fill flex size-7 shrink-0 items-center justify-center rounded-full text-white"
                style={CHANNEL_ICON_STYLE}
              >
                <Hash className="size-4" strokeWidth={2.5} />
              </span>
            }
            time={<RelativeTime date={channel.updatedAt} />}
            badge={directory ? <SessionMetadataBadges cwd={directory} /> : undefined}
            menuItems={<CommandMenuItems commands={channelCommands(channel)} />}
            status={status}
            isActive={isOpen(createChannelPane(channel.id))}
            onClick={(event) =>
              selectRoot(createChannelPane(channel.id), event.metaKey || event.ctrlKey)
            }
          />
        );
      })}
    </SidebarPanel>
  );
}

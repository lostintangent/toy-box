import type { CSSProperties } from "react";
import { Hash, Plus } from "lucide-react";
import { WorkingAgents } from "@channels/components/agents/WorkingAgents";
import { channelCommands } from "@channels/commands";
import { useChannels } from "@channels/useChannels";
import { CommandMenuItems } from "@/shared/commands/CommandMenuItem";
import { SidebarListItem } from "@/shared/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { Button } from "@/shared/ui/button";
import { RelativeTime } from "@/shared/ui/relative-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { SessionMetadataBadges } from "@sessions/components/location/SessionMetadataBadges";
import { channelSidebarStatus } from "./status";

/** The channel icon's identity fill, cyan in both appearances. */
const CHANNEL_ICON_STYLE: CSSProperties & { "--identity": string } = { "--identity": "#0891b2" };

export function ChannelsPanel({
  isExpanded,
  onExpandedChange,
  openChannelIds,
  onChannelOpen,
  onCreate,
}: {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  openChannelIds: string[];
  onChannelOpen: (channelId: string, toggleInWorkspace: boolean) => void;
  onCreate: () => void;
}) {
  const channels = useChannels();
  if (channels.length === 0) return null;

  const rows = channels.map((entry) => ({
    ...entry,
    status: channelSidebarStatus(
      entry.channel,
      entry.status,
      openChannelIds.includes(entry.channel.id),
    ),
  }));

  return (
    <SidebarPanel
      title="Channels"
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      activity={{
        waiting: rows.some(({ status }) => status?.kind === "waiting"),
        finished: rows.some(({ status }) => status?.kind === "finished"),
        unread: rows.some(({ status }) => status?.kind === "unread"),
        running: channels.some(({ agents }) => agents.some(({ isRunning }) => isRunning)),
      }}
      action={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Create channel"
                onClick={onCreate}
              >
                <Plus className="h-4 w-4" />
              </Button>
            }
          />
          <TooltipContent sideOffset={6}>Create channel</TooltipContent>
        </Tooltip>
      }
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
                  working={agents.filter(({ isRunning }) => isRunning).map((agent) => ({ agent }))}
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
            isActive={openChannelIds.includes(channel.id)}
            onClick={(event) => onChannelOpen(channel.id, event.metaKey || event.ctrlKey)}
          />
        );
      })}
    </SidebarPanel>
  );
}

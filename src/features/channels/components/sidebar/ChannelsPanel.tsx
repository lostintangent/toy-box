import { useState } from "react";
import { Hash, Plus } from "lucide-react";
import { AgentStatus } from "@channels/components/agents/AgentStatus";
import { useChannels } from "@channels/useChannels";
import { SidebarListItem } from "@/shared/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { Button } from "@/shared/ui/button";
import { RelativeTime } from "@/shared/ui/relative-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { SessionMetadataBadges } from "@sessions/components/location/SessionMetadataBadges";
import { ChannelDialog } from "../ChannelDialog";
import { ChannelMenuItems } from "../ChannelMenuItems";
import { channelSidebarStatus } from "./status";
import { DeleteChannelDialog } from "../DeleteChannelDialog";

export function ChannelsPanel({
  isExpanded,
  onExpandedChange,
  openChannelIds,
  onChannelOpen,
  onBrowseDirectory,
  onCreate,
}: {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  openChannelIds: string[];
  onChannelOpen: (channelId: string, toggleInWorkspace: boolean) => void;
  onBrowseDirectory: (directory: string) => void;
  onCreate: () => void;
}) {
  const channels = useChannels();
  const [editChannelId, setEditChannelId] = useState<string>();
  const [deleteChannelId, setDeleteChannelId] = useState<string>();
  if (channels.length === 0) return null;

  const editing = channels.find(({ channel }) => channel.id === editChannelId)?.channel;
  const deleting = channels.find(({ channel }) => channel.id === deleteChannelId)?.channel;
  const rows = channels.map((entry) => ({
    ...entry,
    status: channelSidebarStatus(
      entry.channel,
      entry.status,
      openChannelIds.includes(entry.channel.id),
    ),
  }));

  return (
    <>
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
                  <AgentStatus
                    working={agents
                      .filter(({ isRunning }) => isRunning)
                      .map((agent) => ({ agent }))}
                    variant="compact"
                  />
                </span>
              }
              icon={
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                  <Hash className="size-4" />
                </span>
              }
              time={<RelativeTime date={channel.updatedAt} />}
              badge={directory ? <SessionMetadataBadges cwd={directory} /> : undefined}
              menuItems={
                <ChannelMenuItems
                  onEdit={() => setEditChannelId(channel.id)}
                  onBrowse={directory ? () => onBrowseDirectory(directory) : undefined}
                  onDelete={() => setDeleteChannelId(channel.id)}
                />
              }
              status={status}
              isActive={openChannelIds.includes(channel.id)}
              onClick={(event) => onChannelOpen(channel.id, event.metaKey || event.ctrlKey)}
            />
          );
        })}
      </SidebarPanel>

      {editing && (
        <ChannelDialog
          key={editing.id}
          channel={editing}
          onOpenChange={(open) => {
            if (!open) setEditChannelId(undefined);
          }}
        />
      )}

      {deleting && (
        <DeleteChannelDialog
          channel={deleting}
          onOpenChange={(open) => {
            if (!open) setDeleteChannelId(undefined);
          }}
        />
      )}
    </>
  );
}

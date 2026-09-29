import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Hash, Plus } from "lucide-react";
import { AgentStatus } from "@channels/components/agents/AgentStatus";
import { channelLead } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { SidebarListItem } from "@/shared/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import { Button } from "@/shared/ui/button";
import { RelativeTime } from "@/shared/ui/relative-time";
import { selectWorkspaceSessionActivity, useWorkspaceSelector } from "@workspace/hooks/state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { SessionMetadataBadges } from "@sessions/components/location/SessionMetadataBadges";
import { ChannelDialog } from "../ChannelDialog";
import { ChannelMenuItems } from "../ChannelMenuItems";
import { channelAttention } from "./attention";
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
  const {
    data: { channels, members },
  } = useSuspenseQuery(channelQueries.list());
  const [editChannelId, setEditChannelId] = useState<string>();
  const [deleteChannelId, setDeleteChannelId] = useState<string>();
  const running = useWorkspaceSelector((workspace) =>
    [...channels.map(({ id }) => id), ...members.map(({ id }) => id)].some(
      (id) => selectWorkspaceSessionActivity(workspace, id).running,
    ),
  );
  if (channels.length === 0) return null;

  const editing = channels.find(({ id }) => id === editChannelId);
  const deleting = channels.find(({ id }) => id === deleteChannelId);
  const rows = channels.map((channel) => ({
    channel,
    status: channelAttention(channel, openChannelIds.includes(channel.id)),
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
          running,
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
        {rows.map(({ channel, status }) => {
          const channelMembers = members.filter((member) => member.channelId === channel.id);
          const { directory } = channel;

          return (
            <SidebarListItem
              key={channel.id}
              title={channel.name}
              titleContent={
                <span className="flex items-center gap-3">
                  <span>{channel.name}</span>
                  <AgentStatus
                    agents={[channelLead(channel.id), ...channelMembers]}
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

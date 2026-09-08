import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Circle, Hash, Pencil, Plus, Trash2 } from "lucide-react";
import { channelHasUnread } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { channelQueries } from "@channels/queries";
import { NameDialog } from "@/shared/components/sidebar/NameDialog";
import { SidebarListItem } from "@/shared/components/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/components/sidebar/SidebarPanel";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/shared/components/ui/dropdown-menu";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { SessionMetadataBadges } from "@sessions/components/location/SessionMetadataBadges";
import { DeleteChannelDialog } from "./DeleteChannelDialog";

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
  const { data: channels } = useSuspenseQuery(channelQueries.list());
  const [renameChannelId, setRenameChannelId] = useState<string>();
  const [deleteChannelId, setDeleteChannelId] = useState<string>();
  if (channels.length === 0) return null;

  const renaming = channels.find(({ id }) => id === renameChannelId);
  const deleting = channels.find(({ id }) => id === deleteChannelId);

  return (
    <>
      <SidebarPanel
        title="Channels"
        isExpanded={isExpanded}
        onExpandedChange={onExpandedChange}
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
        {channels.map((channel) => (
          <SidebarListItem
            key={channel.id}
            title={channel.title}
            icon={
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                <Hash className="size-4" />
              </span>
            }
            time={<RelativeTime date={channel.updatedAt} />}
            badge={
              channel.directory ? <SessionMetadataBadges cwd={channel.directory} /> : undefined
            }
            menuItems={
              <>
                <DropdownMenuItem onClick={() => setRenameChannelId(channel.id)}>
                  <Pencil /> Rename channel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteChannelId(channel.id)}
                >
                  <Trash2 /> Delete channel
                </DropdownMenuItem>
              </>
            }
            status={
              channelHasUnread(channel) && !openChannelIds.includes(channel.id)
                ? {
                    ariaLabel: `${channel.title} has unread messages`,
                    tooltip: "Channel has unread messages",
                    icon: <Circle className="h-2.5 w-2.5 fill-unread text-unread" aria-hidden />,
                  }
                : undefined
            }
            isActive={openChannelIds.includes(channel.id)}
            onClick={(event) => onChannelOpen(channel.id, event.metaKey || event.ctrlKey)}
            titleClassName="text-sm"
          />
        ))}
      </SidebarPanel>

      {renaming && (
        <NameDialog
          key={renaming.id}
          name={renaming.title}
          title="Rename channel"
          description="Change how this channel appears in the channel list."
          mutation={channelMutations.rename(renaming.id)}
          onOpenChange={(open) => {
            if (!open) setRenameChannelId(undefined);
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

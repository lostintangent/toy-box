import { ChannelAvatar } from "@channels/components/ChannelAvatar";
import { channelAttention, createChannelPane } from "@channels/model";
import { useChannels } from "@channels/useChannels";
import { SidebarList } from "@/shared/sidebar/SidebarList";
import { SidebarStatusMark } from "@/shared/sidebar/SidebarStatus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { RailSeparator } from "@workspace/components/sidebar/SidebarActions";
import { useWorkspaceRoots } from "@workspace/hooks/layout/roots";
import { cn } from "@/shared/utils";
import { channelSidebarStatus } from "./status";
import { ChannelRequestPreview } from "./ChannelRequestPreview";

/** The collapsed sidebar's Channels that are working, waiting on you, or newly finished, each by
 *  its avatar above a divider, so one opens without expanding the sidebar. */
export function ChannelsRail() {
  const { selectRoot, isOpen } = useWorkspaceRoots();
  const channels = useChannels().flatMap(({ channel, agents }) => {
    const pane = createChannelPane(channel.id);
    const open = isOpen(pane);
    const attention = channelAttention(channel, open);
    const kind =
      attention === "waiting" || attention === "finished"
        ? attention
        : agents.some(({ isWorking }) => isWorking)
          ? "running"
          : undefined;
    return kind ? [{ channel, pane, open, status: channelSidebarStatus(channel, kind) }] : [];
  });

  return (
    <>
      {/* The list fills the free height up to three avatars and stacks from its foot, so a leaving
          avatar fades in place while the rest slide down. The padding keeps badges and rings inside
          the scroll viewport, and the matching negative margin measures the divider's gap from the
          avatars. Each badge clips its mark, whose spinning corners would otherwise overflow the
          viewport and make the list scroll. */}
      <SidebarList
        rootClassName="-mb-1.5 mt-auto max-h-30 min-h-0 flex-1 self-stretch"
        className="py-1.5 *:flex *:min-h-full *:flex-col"
        listClassName="grow items-center justify-end gap-4.5"
        scrollbar={false}
      >
        {channels.map(({ channel, pane, open, status }) => {
          const avatar = (
            <button
              type="button"
              aria-label={status.ariaLabel}
              className={cn(
                "relative flex rounded-[26%] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                open && "ring-2 ring-foreground/25 ring-offset-2 ring-offset-background",
              )}
              onClick={(event) => selectRoot(pane, event.metaKey || event.ctrlKey)}
            >
              <ChannelAvatar avatar={channel.avatar} className="size-6" />
              <span className="absolute -right-1.5 -bottom-1.5 flex size-4 items-center justify-center overflow-hidden rounded-full bg-background *:size-3.5">
                <SidebarStatusMark kind={status.kind} />
              </span>
            </button>
          );
          return channel.request ? (
            <ChannelRequestPreview
              key={channel.id}
              channelId={channel.id}
              request={channel.request}
            >
              {avatar}
            </ChannelRequestPreview>
          ) : (
            <Tooltip key={channel.id}>
              <TooltipTrigger render={avatar} />
              <TooltipContent side="right" sideOffset={6}>
                {channel.name} · {status.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </SidebarList>
      <RailSeparator
        className={cn("transition-opacity duration-300", channels.length === 0 && "opacity-0")}
      />
    </>
  );
}

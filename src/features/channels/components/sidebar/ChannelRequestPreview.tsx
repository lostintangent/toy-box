import type { ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { AgentMentionMarkdown } from "@channels/components/agents/AgentMentionMarkdown";
import { RequestReplies } from "@channels/components/RequestReplies";
import type { ChannelConversationMessage } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/shared/ui/preview-card";
import { waitingOutlineClassName } from "@/shared/ui/running-indicator";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { cn, generateUUID } from "@/shared/utils";

/** Hovering a waiting Channel's row or avatar shows its lead's request, on the transcript's amber,
 *  and a suggested reply answers it from there. */
export function ChannelRequestPreview({
  channelId,
  request,
  children,
}: {
  channelId: string;
  request: ChannelConversationMessage;
  children: ReactElement;
}) {
  const { mutate: post } = useMutation(channelMutations.post());

  return (
    <PreviewCard>
      <PreviewCardTrigger delay={400} render={children} />
      <PreviewCardContent
        side="right"
        align="start"
        sideOffset={12}
        className={cn(
          "w-80 rounded-xl bg-[color-mix(in_oklab,var(--color-amber-500)_10%,var(--color-popover))] px-3.5 py-2.5",
          waitingOutlineClassName,
        )}
      >
        <ScrollableFade axis="vertical" className="max-h-72 text-sm">
          <AgentMentionMarkdown content={request.content} />
        </ScrollableFade>
        {request.replies && (
          <RequestReplies
            replies={request.replies}
            onReply={(content) => post({ channelId, id: generateUUID(), content })}
          />
        )}
      </PreviewCardContent>
    </PreviewCard>
  );
}

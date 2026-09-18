import { Suspense, useRef, type RefObject } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary, ClientOnly } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import type { Agent } from "@agents/model";
import { agentQueries } from "@agents/queries";
import type { Channel } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { useChannel } from "@channels/useChannel";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { PaneActions } from "@workspace/components/panes/shell/PaneSlots";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import { ChannelComposer } from "./ChannelComposer";
import { ChannelMenu } from "./ChannelMenu";
import { ChannelTranscript } from "./transcript/ChannelTranscript";

export function ChannelPane({
  channelId,
  isVisible,
  variant,
}: {
  channelId: string;
  isVisible: boolean;
  variant: PaneVariant;
}) {
  const {
    data: { channels, memberships },
  } = useSuspenseQuery(channelQueries.list());
  const { data: agents } = useSuspenseQuery(agentQueries.list());
  const scrollToBottomRef = useRef<() => void>(null);
  const channel = channels.find(({ id }) => id === channelId);

  if (!channel) return <ChannelUnavailable />;
  const members = memberships.filter(({ host }) => host.channelId === channelId);
  const detailFallback = (
    <div className="min-h-0 flex-1">
      <TranscriptSkeleton />
    </div>
  );

  return (
    <CatchBoundary getResetKey={() => channelId} errorComponent={ChannelPaneError}>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <ClientOnly fallback={detailFallback}>
          <Suspense fallback={detailFallback}>
            <ChannelDetail
              channel={channel}
              agents={agents}
              isVisible={isVisible}
              variant={variant}
              scrollToBottomRef={scrollToBottomRef}
            />
          </Suspense>
        </ClientOnly>

        <div className="shrink-0 border-t bg-background px-4 pt-4 md:pb-4">
          <ChannelComposer
            channel={channel}
            members={members}
            agents={agents}
            onSubmit={() => scrollToBottomRef.current?.()}
          />
        </div>
      </div>
    </CatchBoundary>
  );
}

function ChannelDetail({
  channel,
  agents,
  isVisible,
  variant,
  scrollToBottomRef,
}: {
  channel: Channel;
  agents: Agent[];
  isVisible: boolean;
  variant: PaneVariant;
  scrollToBottomRef: RefObject<(() => void) | null>;
}) {
  const { state, loadPrevious } = useChannel(channel, isVisible);

  return (
    <>
      <PaneActions>
        <ChannelMenu
          channel={channel}
          members={state.members}
          agents={agents}
          artifacts={state.artifacts}
          variant={variant}
        />
      </PaneActions>
      <div className="min-h-0 flex-1">
        <ChannelTranscript
          messages={state.messages}
          members={state.members}
          agents={agents}
          scrollToBottomRef={scrollToBottomRef}
          onLoadPrevious={loadPrevious}
        />
      </div>
    </>
  );
}

function ChannelPaneError({ error }: { error: unknown }) {
  return <ChannelUnavailable error={error} />;
}

function ChannelUnavailable({ error }: { error?: unknown }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <AlertCircle className="size-6 text-destructive" />
      <p className="font-medium">Channel unavailable</p>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "It may have been deleted."}
      </p>
    </div>
  );
}

import { Suspense, useRef, type RefObject } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary, ClientOnly } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import type { Channel } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { useChannel } from "@channels/useChannel";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import { ChannelComposer } from "./ChannelComposer";
import { ChannelOverview } from "./ChannelOverview";
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
    data: { channels, members },
  } = useSuspenseQuery(channelQueries.list());
  const scrollToBottomRef = useRef<() => void>(null);
  const channel = channels.find(({ id }) => id === channelId);

  if (!channel) return <ChannelUnavailable />;
  const channelMembers = members.filter((member) => member.channelId === channelId);
  const detailFallback = (
    <div className="col-start-1 row-start-1 min-h-0">
      <TranscriptSkeleton />
    </div>
  );

  return (
    <CatchBoundary getResetKey={() => channelId} errorComponent={ChannelPaneError}>
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto] bg-background">
        <ClientOnly fallback={detailFallback}>
          <Suspense fallback={detailFallback}>
            <ChannelDetail
              channel={channel}
              isVisible={isVisible}
              variant={variant}
              scrollToBottomRef={scrollToBottomRef}
            />
          </Suspense>
        </ClientOnly>

        <div className="col-start-1 row-start-2 shrink-0 border-t bg-background px-4 pt-4 md:pb-4">
          <ChannelComposer
            channel={channel}
            members={channelMembers}
            onSubmit={() => scrollToBottomRef.current?.()}
          />
        </div>
      </div>
    </CatchBoundary>
  );
}

function ChannelDetail({
  channel,
  isVisible,
  variant,
  scrollToBottomRef,
}: {
  channel: Channel;
  isVisible: boolean;
  variant: PaneVariant;
  scrollToBottomRef: RefObject<(() => void) | null>;
}) {
  const { state, loadPrevious } = useChannel(channel, isVisible);

  return (
    <>
      <ChannelOverview
        channel={channel}
        lead={state.lead}
        members={state.members}
        artifacts={state.artifacts}
        variant={variant}
      />
      <div className="col-start-1 row-start-1 min-h-0">
        <ChannelTranscript
          messages={state.messages}
          agents={[state.lead, ...state.members]}
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

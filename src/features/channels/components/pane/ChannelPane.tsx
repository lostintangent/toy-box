import { Suspense, useRef, type RefObject } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary, ClientOnly } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import type { Channel } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { useChannel } from "@channels/useChannel";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import { ChannelComposer, type ChannelComposerHandle } from "./ChannelComposer";
import { ChannelPaneProvider } from "./ChannelPaneContext";
import { ChannelOverview } from "./overview/ChannelOverview";
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
  const composerRef = useRef<ChannelComposerHandle>(null);
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
              composerRef={composerRef}
            />
          </Suspense>
        </ClientOnly>

        <div className="col-start-1 row-start-2 shrink-0 border-t bg-background px-4 pt-4 md:pb-4">
          <ChannelComposer
            channel={channel}
            members={channelMembers}
            handleRef={composerRef}
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
  composerRef,
}: {
  channel: Channel;
  isVisible: boolean;
  variant: PaneVariant;
  scrollToBottomRef: RefObject<(() => void) | null>;
  composerRef: RefObject<ChannelComposerHandle | null>;
}) {
  const { state, unreadAfter, loadPrevious } = useChannel(channel, isVisible);

  return (
    <ChannelPaneProvider
      value={{
        lead: state.lead,
        members: state.members,
        agents: [state.lead, ...state.members],
        reply: (agent) => composerRef.current?.reply(agent),
        mention: () => composerRef.current?.mention(),
      }}
    >
      <ChannelOverview channel={channel} artifacts={state.artifacts} variant={variant} />
      <div className="col-start-1 row-start-1 min-h-0">
        <ChannelTranscript
          messages={state.messages}
          unreadAfter={unreadAfter}
          scrollToBottomRef={scrollToBottomRef}
          onLoadPrevious={loadPrevious}
        />
      </div>
    </ChannelPaneProvider>
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

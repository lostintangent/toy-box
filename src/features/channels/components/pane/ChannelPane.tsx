import { useRef } from "react";
import { CatchBoundary } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useChannel } from "@channels/useChannel";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import { ChannelComposer, type ChannelComposerHandle } from "./ChannelComposer";
import { ChannelPaneProvider } from "./ChannelPaneContext";
import { ChannelOverview } from "./overview/ChannelOverview";
import { ChannelTranscript, type ChannelTranscriptHandle } from "./transcript/ChannelTranscript";

export function ChannelPane({
  channelId,
  isVisible,
  variant,
}: {
  channelId: string;
  isVisible: boolean;
  variant: PaneVariant;
}) {
  return (
    <CatchBoundary getResetKey={() => channelId} errorComponent={ChannelPaneError}>
      <ChannelContent
        key={channelId}
        channelId={channelId}
        isVisible={isVisible}
        variant={variant}
      />
    </CatchBoundary>
  );
}

function ChannelContent({
  channelId,
  isVisible,
  variant,
}: {
  channelId: string;
  isVisible: boolean;
  variant: PaneVariant;
}) {
  const { state, unreadAfter, loadPrevious, postMessage } = useChannel(channelId, {
    visible: isVisible,
  });
  const transcriptRef = useRef<ChannelTranscriptHandle>(null);
  const composerRef = useRef<ChannelComposerHandle>(null);
  return (
    <ChannelPaneProvider
      value={
        state && {
          lead: state.lead,
          members: state.members,
          agents: [state.lead, ...state.members],
          presence: state.presence,
          reply: (agent) => composerRef.current?.reply(agent),
          mention: () => composerRef.current?.mention(),
        }
      }
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto] bg-background">
        {state && (
          <ChannelOverview
            channel={state.channel}
            artifacts={state.artifacts}
            routines={state.routines}
            variant={variant}
          />
        )}
        <div className="col-start-1 row-start-1 min-h-0">
          {state ? (
            <ChannelTranscript
              messages={state.messages}
              unreadAfter={unreadAfter}
              handleRef={transcriptRef}
              requestSequence={state.channel.requestSequence}
              onLoadPrevious={loadPrevious}
            />
          ) : (
            <TranscriptSkeleton />
          )}
        </div>
        <div className="col-start-1 row-start-2 shrink-0 border-t bg-background px-4 pt-4 md:pb-4">
          <ChannelComposer
            channelId={channelId}
            state={state}
            handleRef={composerRef}
            onSubmit={(message) => {
              transcriptRef.current?.scrollToBottom();
              postMessage(message);
            }}
            onShowRequest={() => transcriptRef.current?.showRequest()}
          />
        </div>
      </div>
    </ChannelPaneProvider>
  );
}

function ChannelPaneError({ error }: { error: unknown }) {
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

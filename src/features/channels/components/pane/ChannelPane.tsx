import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { AlertCircle, MessagesSquare, UserRound } from "lucide-react";
import { channelAgentIdentity, channelLead } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { useChannel } from "@channels/useChannel";
import type { PaneVariant } from "@/shared/panes/PaneSlots";
import { PaneViewMenu } from "@/shared/panes/PaneViewMenu";
import { TranscriptSkeleton } from "@/shared/messages/TranscriptSkeleton";
import { ChannelComposer, type ChannelComposerHandle } from "./ChannelComposer";
import { ChannelPaneProvider } from "./ChannelPaneContext";
import { ChannelOverview } from "./overview/ChannelOverview";
import { ChannelTranscript, type ChannelTranscriptHandle } from "./transcript/ChannelTranscript";
import type { TranscriptView } from "./transcript/transcriptRows";

const TRANSCRIPT_VIEWS = [
  { value: "all", label: "All messages", Icon: MessagesSquare },
  { value: "yours", label: "Your messages", Icon: UserRound },
] as const;

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
  const { state, presence, unreadAfter, loadPrevious, postMessage } = useChannel(channelId, {
    visible: isVisible,
  });
  const transcriptRef = useRef<ChannelTranscriptHandle>(null);
  const composerRef = useRef<ChannelComposerHandle>(null);
  const [view, setView] = useState<TranscriptView>("all");
  const { mutate: bookmark } = useMutation(channelMutations.bookmark());
  // The lead is intrinsic, so the composer can address it before the first snapshot arrives.
  const lead = state?.lead ?? channelLead(channelId);
  const members = state?.members ?? [];
  const agents = [lead, ...members];
  const send = (message: Parameters<typeof postMessage>[0]) => {
    transcriptRef.current?.followNextPost();
    return postMessage(message);
  };

  return (
    <ChannelPaneProvider
      value={{
        lead,
        members,
        agents,
        agent: (id) => channelAgentIdentity(agents, id),
        presence,
        bookmarks: state?.bookmarks ?? [],
        bookmark: (sequence, bookmarked) => bookmark({ channelId, sequence, bookmarked }),
        reply: (agent) => composerRef.current?.reply(agent),
        answer: (content) => void send({ content }).catch(console.error),
        mention: () => composerRef.current?.mention(),
      }}
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto] bg-background">
        {state && (
          <ChannelOverview
            channel={state.channel}
            artifacts={state.artifacts}
            routines={state.routines}
            variant={variant}
            actions={<PaneViewMenu view={view} views={TRANSCRIPT_VIEWS} onViewChange={setView} />}
          />
        )}
        <div className="col-start-1 row-start-1 min-h-0">
          {state ? (
            <ChannelTranscript
              // Each view lands afresh, since its rows and their keys differ.
              key={view}
              messages={state.messages}
              view={view}
              unreadAfter={unreadAfter}
              handleRef={transcriptRef}
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
            onSubmit={send}
            onShowMessage={(sequence) => transcriptRef.current?.showMessage(sequence)}
            onLoadPrevious={loadPrevious}
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

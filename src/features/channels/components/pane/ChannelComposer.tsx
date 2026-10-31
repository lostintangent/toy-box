import { AgentMentionMarkdown } from "@channels/components/agents/AgentMentionMarkdown";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/shared/ui/preview-card";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { useImperativeHandle, type RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentCompletionMenu } from "@channels/components/agents/AgentCompletionMenu";
import { agentCompletionSource } from "@channels/components/agents/agentCompletionSource";
import {
  agentHandleFromName,
  channelArtifactsNewestFirst,
  channelAudienceLabel,
  channelHasPendingRequest,
  channelTasksDiff,
  resolveChannelAudience,
  type ChannelAgent,
  type ChannelState,
  type PostChannelMessageInput,
} from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { useRevealFile } from "@files/useRevealFile";
import { ComposerTray } from "@sessions/components/outputs/ComposerTray";
import { useSavedDraft } from "@workspace/hooks/useSavedDraft";
import { Composer, ComposerSendButton } from "@/shared/composers/Composer";
import { useComposerDraft } from "@/shared/composers/useComposerDraft";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";
import { useChannelPane } from "./ChannelPaneContext";
import { useChannelTaskItems, TaskDiff } from "./channelTaskItems";
import { WorkspacePreview } from "@sessions/components/outputs/WorkspacePreview";

/** Starts a message from elsewhere in the pane, continuing whatever draft exists. */
export type ChannelComposerHandle = {
  /** Addresses the draft to an agent by mentioning it first. */
  reply: (agent: ChannelAgent) => void;
  /** Begins a mention, so its menu can address or add an agent. */
  mention: () => void;
};

export function ChannelComposer({
  channelId,
  state,
  handleRef,
  onSubmit,
  onShowRequest,
}: {
  channelId: string;
  state?: ChannelState;
  handleRef: RefObject<ChannelComposerHandle | null>;
  onSubmit: (message: Pick<PostChannelMessageInput, "content" | "attachments">) => void;
  onShowRequest: () => void;
}) {
  const openArtifact = useRevealFile();
  const channel = state?.channel;
  const diff = channelTasksDiff(channel?.tasks ?? []);
  const request = state?.request;
  const needsReply = channel ? channelHasPendingRequest(channel) : false;
  const { lead, members, agents } = useChannelPane();
  const artifacts = channelArtifactsNewestFirst(state?.artifacts ?? []).map(
    ({ file, title, sharedAt }) => ({ file, label: title, time: Date.parse(sharedAt) }),
  );
  const draft = useComposerDraft({
    ...useSavedDraft(`channel:${channelId}`),
    onSend: onSubmit,
    disabled: !state,
  });
  const createMember = useMutation(channelMutations.createMember());
  // Delivery resolves the same audience, so this is exactly who the message will wake.
  const audience = resolveChannelAudience({
    content: draft.value,
    sender: { type: "user" },
    lead,
    members,
    acknowledgedRequest: needsReply,
  });

  useImperativeHandle(handleRef, () => ({
    reply: (agent) => {
      const mention = `@${agentHandleFromName(agent.name)} `;
      if (!draft.value.startsWith(mention)) draft.setValue(`${mention}${draft.value}`);
      draft.focus();
    },
    mention: () => {
      const { value } = draft;
      draft.setValue(value === "" || /\s$/.test(value) ? `${value}@` : `${value} @`);
      draft.focus();
    },
  }));

  const checklist = useChannelTaskItems({
    tasks: channel?.tasks ?? [],
    owners: agents,
    artifacts: state?.artifacts ?? [],
    onArtifactOpen: ({ file }) => openArtifact(file),
    closeOnArtifactOpen: true,
  });

  return (
    <Composer
      draft={draft}
      tray={
        <ComposerTray
          artifacts={artifacts}
          checklist={checklist}
          artifactTimeLabel="Shared"
          checklistLabel="Tasks"
          checklistHeaderDetail={diff && <TaskDiff diff={diff} />}
          extraOutput={channel?.preview && <WorkspacePreview preview={channel.preview} />}
          onOpenArtifact={openArtifact}
        />
      }
      completions={{
        sources: [
          agentCompletionSource({
            lead,
            members,
            createMember: (name) => createMember.mutateAsync({ channelId, name }),
          }),
        ],
        menu: (completions) => <AgentCompletionMenu completions={completions} />,
      }}
      controls={
        <>
          <ChannelAudience audience={audience} agentCount={agents.length} />
          {request && <InputNeeded request={request.content} onShow={onShowRequest} />}
        </>
      }
      actions={<ComposerSendButton draft={draft} label="Send message" />}
      label="Channel message"
      placeholder={
        needsReply
          ? `Reply to ${lead.name}, or @mention an agent`
          : `Message ${channel ? `#${channel.name}` : "the channel"}, or @mention an agent`
      }
    />
  );
}

/** Who the draft will wake. Mentions that match no agent leave a posted message unheard. */
function ChannelAudience({
  audience,
  agentCount,
}: {
  audience: readonly ChannelAgent[];
  agentCount: number;
}) {
  const summary =
    audience.length === 0
      ? "No agent matches these mentions"
      : `Wakes ${audience.map(({ name }) => name).join(", ")}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={summary}
            className={cn(
              "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              audience.length === 0 && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          />
        }
      >
        {audience.length === 0 ? (
          "No one will be notified"
        ) : (
          <>
            To
            <span className="flex shrink-0 gap-0.5">
              {audience.map((agent) => (
                <AgentAvatar key={agent.id} agent={agent} className="size-4" />
              ))}
            </span>
            <span className="truncate font-medium text-foreground">
              {channelAudienceLabel(audience, agentCount)}
            </span>
          </>
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{summary}</TooltipContent>
    </Tooltip>
  );
}

/** The lead's pending question: hovering previews it, and clicking scrolls to it. */
function InputNeeded({ request, onShow }: { request: string; onShow: () => void }) {
  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={<button type="button" />}
        onClick={onShow}
        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs hover:bg-muted"
      >
        <RunningIndicator waiting className="size-3.5" />
        Input needed
      </PreviewCardTrigger>
      <PreviewCardContent
        side="top"
        align="start"
        className="max-h-72 w-80 overflow-y-auto text-sm"
      >
        <AgentMentionMarkdown content={request} />
      </PreviewCardContent>
    </PreviewCard>
  );
}

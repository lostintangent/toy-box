import { AgentMention } from "@channels/components/agents/AgentMention";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/shared/ui/preview-card";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { ArrowUp, MonitorPlay } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentPicker } from "@channels/components/agents/AgentPicker";
import { agentPickerSuggestions } from "@channels/components/agents/agentPickerSuggestions";
import { useAgentCompletions } from "@channels/components/agents/useAgentCompletions";
import {
  agentHandleFromName,
  channelAudienceLabel,
  channelHasPendingRequest,
  channelLead,
  channelTasksDiff,
  resolveChannelAudience,
  type ChannelAgent,
  type ChannelState,
  type PostChannelMessageInput,
} from "@channels/model";
import type { WorkspaceFile } from "@files/model";
import { outputPillClassName } from "@workspace/components/outputs/ArtifactPill";
import { ComposerTray } from "@workspace/components/outputs/ComposerTray";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { createEditorPaneId } from "@workspace/model/panes";
import {
  AttachImageButton,
  ImageAttachments,
} from "@/shared/composers/attachments/ImageAttachments";
import { useAttachments } from "@/shared/composers/attachments/useAttachments";
import { TypingEffect } from "@/shared/composers/typing-effect/TypingEffect";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { HTML_SANDBOX_PERMISSIONS } from "@/shared/embeddedHtml";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";
import { channelTaskItems, TaskDiff } from "./channelTaskItems";

/** Starts a message from elsewhere in the pane, continuing whatever draft exists. */
export type ChannelComposerHandle = {
  /** Addresses the draft to an agent by mentioning it first. */
  reply: (agent: ChannelAgent) => void;
  /** Begins a mention, so the picker can address or add an agent. */
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
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { hydrated, isMobile } = useViewport();
  const { revealFile, focusedPaneAtom } = useWorkspaceSurface();
  const attachments = useAttachments();
  const channel = state?.channel;
  const diff = channelTasksDiff(channel?.tasks ?? []);
  const request = state?.request;
  const needsReply = channel ? channelHasPendingRequest(channel) : false;
  const lead = state?.lead ?? channelLead(channelId);
  const members = state?.members ?? [];
  const artifacts = state?.artifacts
    .map(({ file, title, sharedAt }) => ({ file, label: title, time: Date.parse(sharedAt) }))
    .reverse();
  const agents = [lead, ...members];
  const isLoading = !state;
  const completions = useAgentCompletions({
    value: content,
    onValueChange: setContent,
    textareaRef,
    suggestionsFor: (query) => agentPickerSuggestions(query, lead, members),
    channelId,
  });
  // Delivery resolves the same audience, so this is exactly who the message will wake.
  const audience = resolveChannelAudience({
    content,
    sender: { type: "user" },
    lead,
    members,
    acknowledgedRequest: needsReply,
  });

  useEffect(() => {
    if (hydrated && !isMobile && !isLoading) textareaRef.current?.focus();
  }, [hydrated, isMobile, isLoading]);

  useImperativeHandle(handleRef, () => ({
    reply: (agent) => {
      const mention = `@${agentHandleFromName(agent.name)} `;
      completions.replace(content.startsWith(mention) ? content : `${mention}${content}`);
    },
    mention: () =>
      completions.replace(content === "" || /\s$/.test(content) ? `${content}@` : `${content} @`),
  }));

  function submit() {
    if (isSubmitDisabled) return;
    const message = content.trim();
    const images = attachments.items;
    setContent("");
    attachments.clear();
    completions.close();
    onSubmit({
      content: message,
      attachments: images.length > 0 ? images : undefined,
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (completions.handleKeyDown(event)) return;
    if (event.key === "Backspace" && content === "" && attachments.items.length > 0) {
      event.preventDefault();
      attachments.removeLast();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  const isSubmitDisabled =
    isLoading ||
    attachments.pendingCount > 0 ||
    (!content.trim() && attachments.items.length === 0);

  function openArtifact(file: WorkspaceFile) {
    if (revealFile) revealFile(file);
    else focusedPaneAtom.set(createEditorPaneId(file));
  }

  return (
    <form
      className="@container w-full"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      {...attachments.dropTargetProps}
    >
      <input {...attachments.fileInputProps} />
      <ComposerTray
        artifacts={artifacts ?? []}
        checklist={channelTaskItems({
          tasks: channel?.tasks ?? [],
          owners: agents,
          artifacts: state?.artifacts ?? [],
          onArtifactOpen: ({ file }) => openArtifact(file),
          closeOnArtifactOpen: true,
        })}
        artifactTimeLabel="Shared"
        checklistLabel="Tasks"
        checklistHeaderDetail={diff && <TaskDiff diff={diff} />}
        extraOutput={
          channel?.previewUrl && (
            <PreviewCard>
              <PreviewCardTrigger
                delay={400}
                render={<a href={channel.previewUrl} target="_blank" rel="noreferrer" />}
                className={outputPillClassName}
              >
                <MonitorPlay className="size-3.5 shrink-0" />
                Preview
              </PreviewCardTrigger>
              <PreviewCardContent
                side="top"
                align="end"
                sideOffset={8}
                className="hidden p-2 md:block"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-background">
                  <iframe
                    src={channel.previewUrl}
                    title={`Preview ${channel.previewUrl}`}
                    sandbox={HTML_SANDBOX_PERMISSIONS}
                    loading="lazy"
                    tabIndex={-1}
                    width={960}
                    height={540}
                    className="absolute top-0 left-0 origin-top-left scale-[0.25] border-0"
                  />
                </div>
                <p
                  className="mt-2 truncate text-xs text-muted-foreground"
                  title={channel.previewUrl}
                >
                  {channel.previewUrl}
                </p>
              </PreviewCardContent>
            </PreviewCard>
          )
        }
        onOpenArtifact={openArtifact}
      />
      <InputGroup className={cn(attachments.isDragging && "border-ring ring-[3px] ring-ring/50")}>
        <ImageAttachments
          attachments={attachments.items}
          pendingCount={attachments.pendingCount}
          isDragging={attachments.isDragging}
          onRemove={attachments.remove}
        />
        {completions.isOpen && (
          <AgentPicker
            suggestions={completions.suggestions}
            activeIndex={completions.activeIndex}
            onActiveIndexChange={completions.setActiveIndex}
            onSelect={completions.selectSuggestion}
            error={completions.error}
          />
        )}
        <InputGroupTextarea
          ref={textareaRef}
          disabled={isLoading}
          value={content}
          onChange={completions.handleChange}
          onSelect={completions.handleSelect}
          onKeyDown={handleKeyDown}
          onPaste={attachments.handlePaste}
          placeholder={
            needsReply
              ? `Reply to ${lead.name}, or @mention an agent`
              : `Message ${channel ? `#${channel.name}` : "the channel"}, or @mention an agent`
          }
          className="max-h-18 min-h-14 overflow-y-auto py-2 text-sm"
          rows={1}
        />
        <InputGroupAddon align="block-end" className="relative justify-between px-2 pt-0 pb-2">
          <TypingEffect value={content} />
          <div className="relative flex min-w-0 items-center gap-1">
            <AttachImageButton onClick={attachments.openPicker} />
            <ChannelAudience audience={audience} agentCount={agents.length} />
            {request && (
              <PreviewCard>
                <PreviewCardTrigger
                  render={<button type="button" />}
                  onClick={onShowRequest}
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
                  <AgentMention content={request.content} />
                </PreviewCardContent>
              </PreviewCard>
            )}
          </div>
          <div className="relative flex items-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    type="submit"
                    size="icon-xs"
                    aria-label="Send channel message"
                    disabled={isSubmitDisabled}
                    variant={isSubmitDisabled ? "ghost" : "accent"}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </InputGroupButton>
                }
              />
              <TooltipContent sideOffset={6}>Send message</TooltipContent>
            </Tooltip>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
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
                <AgentAvatar
                  key={agent.id}
                  name={agent.name}
                  avatar={agent.avatar}
                  className="size-4"
                />
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

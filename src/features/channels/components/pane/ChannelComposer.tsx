import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, MonitorPlay } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentPicker } from "@channels/components/agents/AgentPicker";
import { agentPickerSuggestions } from "@channels/components/agents/agentPickerSuggestions";
import { useAgentCompletions } from "@channels/components/agents/useAgentCompletions";
import {
  agentHandleFromName,
  channelAudienceLabel,
  channelLead,
  resolveChannelAudience,
  type Channel,
  type ChannelAgent,
  type ChannelMember,
} from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { channelQueries } from "@channels/queries";
import { outputPillClassName } from "@workspace/components/outputs/ArtifactPill";
import { ComposerTray } from "@workspace/components/outputs/ComposerTray";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
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
import { useViewport } from "@/shared/hooks/useViewport";
import { cn, generateUUID } from "@/shared/utils";
import { channelChecklistItems } from "./channelChecklistItems";

/** Starts a message from elsewhere in the pane, continuing whatever draft exists. */
export type ChannelComposerHandle = {
  /** Addresses the draft to an agent by mentioning it first. */
  reply: (agent: ChannelAgent) => void;
  /** Begins a mention, so the picker can address or add an agent. */
  mention: () => void;
};

export function ChannelComposer({
  channel,
  members,
  handleRef,
  onSubmit,
}: {
  channel: Channel;
  members: ChannelMember[];
  handleRef: RefObject<ChannelComposerHandle | null>;
  onSubmit: () => void;
}) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isMobile } = useViewport();
  const { revealFile } = useWorkspaceSurface();
  const attachments = useAttachments();
  const { mutate: postMessage } = useMutation(channelMutations.post());
  // Shared artifacts arrive with the transcript's state, oldest first. The tray waits for them
  // and lists the newest first.
  const { data: artifacts } = useQuery({
    ...channelQueries.detail(channel.id),
    select: (state) =>
      state.artifacts
        .map(({ file, title, sharedAt }) => ({ file, label: title, time: Date.parse(sharedAt) }))
        .reverse(),
  });
  const lead = channelLead(channel.id);
  const agents = [lead, ...members];
  const completions = useAgentCompletions({
    value: content,
    onValueChange: setContent,
    textareaRef,
    suggestionsFor: (query) => agentPickerSuggestions(query, lead, members),
    channelId: channel.id,
  });
  // Delivery resolves the same audience, so this is exactly who the message will wake.
  const audience = resolveChannelAudience({
    content,
    sender: { type: "user" },
    lead,
    members,
    acknowledgedRequest: channel.hasPendingRequest,
  });

  useEffect(() => {
    if (!isMobile) textareaRef.current?.focus();
  }, [isMobile]);

  useImperativeHandle(handleRef, () => ({
    reply: (agent) => {
      const mention = `@${agentHandleFromName(agent.name)} `;
      completions.replace(content.startsWith(mention) ? content : `${mention}${content}`);
    },
    mention: () =>
      completions.replace(content === "" || /\s$/.test(content) ? `${content}@` : `${content} @`),
  }));

  function submit() {
    const message = content.trim();
    if (attachments.pendingCount > 0 || (!message && attachments.items.length === 0)) return;
    const images = attachments.items;
    setContent("");
    attachments.clear();
    completions.close();
    onSubmit();
    postMessage({
      id: generateUUID(),
      channelId: channel.id,
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
    attachments.pendingCount > 0 || (!content.trim() && attachments.items.length === 0);

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
      {artifacts && (
        <ComposerTray
          artifacts={artifacts}
          checklist={channelChecklistItems(channel.checklist, agents)}
          artifactTimeLabel="Shared"
          checklistLabel="Checklist"
          extraOutput={
            channel.previewUrl && (
              <a
                href={channel.previewUrl}
                target="_blank"
                rel="noreferrer"
                title={channel.previewUrl}
                className={outputPillClassName}
              >
                <MonitorPlay className="size-3.5 shrink-0" />
                Preview
              </a>
            )
          }
          onOpenArtifact={revealFile}
        />
      )}
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
          value={content}
          onChange={completions.handleChange}
          onSelect={completions.handleSelect}
          onKeyDown={handleKeyDown}
          onPaste={attachments.handlePaste}
          placeholder={
            channel.hasPendingRequest
              ? `Reply to ${lead.name}, or @mention an agent`
              : `Message #${channel.name}, or @mention an agent`
          }
          className="max-h-18 min-h-14 overflow-y-auto py-2 text-sm"
          rows={1}
        />
        <InputGroupAddon align="block-end" className="relative justify-between px-2 pt-0 pb-2">
          <TypingEffect value={content} />
          <div className="relative flex min-w-0 items-center gap-1">
            <AttachImageButton onClick={attachments.openPicker} />
            <ChannelAudience audience={audience} agentCount={agents.length} />
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

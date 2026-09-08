import { useEffect, useRef, useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowUp } from "lucide-react";
import {
  StickToBottom,
  useStickToBottomContext,
  type StickToBottomContext,
} from "use-stick-to-bottom";
import { AgentInvitationChips } from "@agents/components/AgentInvitationChips";
import { AgentPicker } from "@agents/components/AgentPicker";
import {
  agentPickerSuggestions,
  type AgentPickerSuggestion,
} from "@agents/components/agentPickerSuggestions";
import { AgentMention } from "@agents/components/AgentMention";
import { AgentStatus } from "@agents/components/AgentStatus";
import { AgentAvatar } from "@agents/components/AgentAvatar";
import { useAgentMentionInput } from "@agents/components/useAgentMentionInput";
import { findMentionedAgents, type Agent } from "@agents/model";
import { agentQueries } from "@agents/queries";
import {
  resolveChannelAudience,
  type Channel,
  type ChannelMember,
  type ChannelMessage,
  type ChannelReaction,
} from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { useChannel } from "@channels/useChannel";
import { ChannelMenu } from "@channels/components/ChannelMenu";
import { ChannelPlaceholder } from "@channels/components/ChannelPlaceholder";
import type { PaneVariant } from "@workspace/components/panes/WorkspacePaneView";
import { PaneActions } from "@workspace/components/panes/shell/PaneSlots";
import { AttachmentGallery } from "@sessions/components/AttachmentGallery";
import {
  AttachImageButton,
  ImageAttachments,
} from "@sessions/components/composer/ImageAttachments";
import { TypingEffect } from "@sessions/components/composer/typing-effect/TypingEffect";
import { useImageAttachments } from "@sessions/components/composer/useImageAttachments";
import { UserMessage } from "@sessions/components/transcript/messages/UserMessage";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/components/ui/input-group";
import { RelativeTime } from "@/shared/components/ui/relative-time";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { ScrollToBottomButton } from "@/shared/components/ui/scroll-to-bottom-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn, generateUUID } from "@/shared/utils";

const DELETED_AGENT_LABEL = "Deleted agent";

export function ChannelPane({
  channelId,
  isVisible,
  variant,
}: {
  channelId: string;
  isVisible: boolean;
  variant: PaneVariant;
}) {
  const { channel, snapshot, error } = useChannel(channelId, isVisible);
  const { data: agents } = useSuspenseQuery(agentQueries.list());
  const transcriptRef = useRef<StickToBottomContext>(null);

  const members = snapshot?.members ?? [];
  if (error || !channel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <p className="font-medium">Channel unavailable</p>
        <p className="text-sm text-muted-foreground">
          {error?.message ?? "It may have been deleted."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PaneActions>
        <ChannelMenu
          channel={channel}
          members={members}
          agents={agents}
          artifacts={snapshot?.artifacts ?? []}
          variant={variant}
        />
      </PaneActions>

      <div className="min-h-0 flex-1">
        {!snapshot ? (
          <TranscriptSkeleton />
        ) : (
          <StickToBottom
            contextRef={transcriptRef}
            className="relative h-full bg-panel"
            resize="smooth"
            initial="instant"
          >
            <ChannelTranscript messages={snapshot.messages} members={members} agents={agents} />
            <ScrollToBottomButton />
          </StickToBottom>
        )}
      </div>

      <div className="shrink-0 border-t bg-background px-4 pt-4 md:pb-4">
        <ChannelComposer
          channel={channel}
          members={members}
          agents={agents}
          onSubmit={() => void transcriptRef.current?.scrollToBottom({ animation: "smooth" })}
        />
      </div>
    </div>
  );
}

function ChannelTranscript({
  messages,
  members,
  agents,
}: {
  messages: ChannelMessage[];
  members: ChannelMember[];
  agents: Agent[];
}) {
  const { contentRef, scrollRef } = useStickToBottomContext();

  return (
    <ScrollableFade ref={scrollRef} axis="vertical" rootClassName="size-full">
      <div ref={contentRef} className="@container min-h-full px-4 py-5">
        {messages.length === 0 ? (
          <ChannelPlaceholder />
        ) : (
          <div className="space-y-5">
            {messages.map((message) => (
              <ChannelMessageView key={message.id} message={message} agents={agents} />
            ))}
          </div>
        )}
        <div className="mt-4 space-y-2 empty:hidden">
          <AgentStatus memberships={members} agents={agents} />
        </div>
      </div>
    </ScrollableFade>
  );
}

function ChannelMessageView({ message, agents }: { message: ChannelMessage; agents: Agent[] }) {
  const sender = message.sender;
  if (sender.type === "system") {
    return (
      <div className="flex items-center justify-center gap-2 text-center text-xs italic text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>{message.content}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (sender.type === "user") {
    return (
      <UserMessage
        message={message}
        extraActions={
          message.reactions.length > 0 ? (
            <div className="mr-1">
              <ChannelMessageReactions reactions={message.reactions} agents={agents} />
            </div>
          ) : undefined
        }
      />
    );
  }

  const agent = agents.find(({ id }) => id === sender.agentId);
  const agentName = agent?.name ?? DELETED_AGENT_LABEL;
  const attachments = message.attachments ?? [];
  return (
    <article className="flex gap-3">
      <AgentAvatar name={agent?.name ?? "?"} avatar={agent?.avatar} />
      <div className="min-w-0 max-w-full @md:max-w-[80%]">
        <div className="mb-1 flex items-center gap-2">
          <span className={cn("text-xs font-semibold", !agent && "italic")}>{agentName}</span>
          <RelativeTime className="text-2xs text-muted-foreground" date={message.timestamp} />
        </div>
        {message.content && (
          <div className="rounded-xl border bg-secondary-background px-3.5 py-2.5 text-left">
            <AgentMention content={message.content} />
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <AttachmentGallery attachments={attachments} />
          </div>
        )}
        {message.reactions.length > 0 && (
          <div className="mt-2">
            <ChannelMessageReactions reactions={message.reactions} agents={agents} />
          </div>
        )}
      </div>
    </article>
  );
}

const REACTION_PRESENTATION = {
  looking: { emoji: "👀", label: "Looking" },
  agree: { emoji: "👍", label: "Agreed" },
  celebrate: { emoji: "🎉", label: "Celebrated" },
  love: { emoji: "❤️", label: "Loved this" },
  laugh: { emoji: "😂", label: "Laughed" },
} satisfies Record<ChannelReaction["reaction"], { emoji: string; label: string }>;

function ChannelMessageReactions({
  reactions,
  agents,
}: {
  reactions: ChannelReaction[];
  agents: Agent[];
}) {
  const groups = new Map<ChannelReaction["reaction"], string[]>();
  for (const reaction of reactions) {
    const names = groups.get(reaction.reaction) ?? [];
    names.push(agents.find(({ id }) => id === reaction.agentId)?.name ?? DELETED_AGENT_LABEL);
    groups.set(reaction.reaction, names);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {[...groups].map(([reaction, names]) => {
        const presentation = REACTION_PRESENTATION[reaction];
        return (
          <Tooltip key={reaction}>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  aria-label={`${presentation.label}: ${names.join(", ")}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-2xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <span aria-hidden>{presentation.emoji}</span>
              {names.length > 1 && <span className="tabular-nums">{names.length}</span>}
            </TooltipTrigger>
            <TooltipContent sideOffset={4} className="max-w-72">
              {names.join(", ")}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ChannelComposer({
  channel,
  members,
  agents,
  onSubmit,
}: {
  channel: Channel;
  members: ChannelMember[];
  agents: Agent[];
  onSubmit: () => void;
}) {
  const [content, setContent] = useState("");
  const [worktreeAgentIds, setWorktreeAgentIds] = useState<Set<string>>(() => new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isMobile } = useViewport();
  const {
    attachments,
    isDragging,
    handlePaste,
    fileInputProps,
    openPicker,
    dropTargetProps,
    clearAttachments,
    removeAttachment,
  } = useImageAttachments();
  const post = useMutation(channelMutations.post());
  const invitations = resolveChannelAudience({
    content,
    sender: { type: "user" },
    members,
    agents,
  }).invitations.map((agent) => ({
    agent,
    executionMode: worktreeAgentIds.has(agent.id) ? ("worktree" as const) : ("shared" as const),
  }));
  const mention = useAgentMentionInput({
    value: content,
    onValueChange: setContent,
    textareaRef,
    suggestionsFor: (query) => channelMentionSuggestions(query, agents, members),
  });

  useEffect(() => {
    if (!isMobile) textareaRef.current?.focus();
  }, [isMobile]);

  function submit() {
    const message = content.trim();
    if ((!message && attachments.length === 0) || post.isPending) return;
    setContent("");
    clearAttachments();
    mention.close();
    onSubmit();
    post.mutate({
      id: generateUUID(),
      channelId: channel.id,
      content: message,
      attachments: attachments.length > 0 ? attachments : undefined,
      agentMentions: findMentionedAgents(message, agents).map(({ id }) => ({
        agentId: id,
        ...(invitations.find(({ agent }) => agent.id === id)?.executionMode === "worktree"
          ? { initialExecutionMode: "worktree" as const }
          : {}),
      })),
    });
    setWorktreeAgentIds(new Set());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.handleKeyDown(event)) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  const isSubmitDisabled = !content.trim() && attachments.length === 0;

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      {...dropTargetProps}
    >
      <input {...fileInputProps} />
      <ImageAttachments attachments={attachments} onRemove={removeAttachment} />
      <div className="relative">
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-lg bg-blue-500/20" />
        )}
        <InputGroup>
          {mention.isOpen && (
            <AgentPicker
              suggestions={mention.suggestions}
              activeIndex={mention.activeIndex}
              onActiveIndexChange={mention.setActiveIndex}
              onSelect={mention.selectSuggestion}
              error={mention.error}
            />
          )}
          <InputGroupTextarea
            ref={textareaRef}
            value={content}
            onChange={mention.handleChange}
            onSelect={mention.handleSelect}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={`Message #${channel.title}, or @mention an agent`}
            className="max-h-18 min-h-14 overflow-y-auto py-2 text-sm"
            rows={1}
          />
          <AgentInvitationChips
            invitations={invitations}
            canUseWorktrees={Boolean(channel.directory)}
            onExecutionModeChange={(agentId, mode) =>
              setWorktreeAgentIds((current) => {
                const next = new Set(current);
                if (mode === "worktree") next.add(agentId);
                else next.delete(agentId);
                return next;
              })
            }
          />
          <InputGroupAddon align="block-end" className="relative justify-between pt-0 pb-2">
            <TypingEffect value={content} />
            <div className="relative flex items-center gap-1">
              <AttachImageButton onClick={openPicker} />
            </div>
            <div className="relative flex items-center">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      type="submit"
                      size="icon-xs"
                      aria-label="Send channel message"
                      disabled={isSubmitDisabled || post.isPending}
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
      </div>
      {post.error && <p className="mt-1 text-xs text-destructive">{post.error.message}</p>}
    </form>
  );
}

function channelMentionSuggestions(
  query: string,
  agents: readonly Agent[],
  members: readonly ChannelMember[],
): AgentPickerSuggestion[] {
  const normalizedQuery = query.toLowerCase();
  const suggestions = agentPickerSuggestions({
    query,
    agents,
    memberships: members,
    hostKind: "channel",
  });
  if (members.length > 0 && "everyone".includes(normalizedQuery)) {
    suggestions.unshift({
      handle: "everyone",
      name: "Everyone",
      description: `Wake all ${members.length} current ${members.length === 1 ? "agent" : "agents"}`,
      group: "Channel",
      kind: "everyone",
    });
  }
  return suggestions;
}

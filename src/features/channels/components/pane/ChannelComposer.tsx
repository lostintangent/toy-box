import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { AgentInvitationChips } from "@agents/components/AgentInvitationChips";
import { AgentPicker } from "@agents/components/AgentPicker";
import {
  agentPickerSuggestions,
  type AgentPickerSuggestion,
} from "@agents/components/agentPickerSuggestions";
import { useAgentMentionInput } from "@agents/components/useAgentMentionInput";
import type { Agent, AgentMembership } from "@agents/model";
import { resolveChannelAudience, type Channel } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import {
  AttachImageButton,
  ImageAttachments,
} from "@sessions/components/composer/ImageAttachments";
import { TypingEffect } from "@sessions/components/composer/typing-effect/TypingEffect";
import { useImageAttachments } from "@sessions/components/composer/useImageAttachments";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { useViewport } from "@/shared/hooks/useViewport";
import { generateUUID } from "@/shared/utils";

export function ChannelComposer({
  channel,
  members,
  agents,
  onSubmit,
}: {
  channel: Channel;
  members: AgentMembership[];
  agents: Agent[];
  onSubmit: () => void;
}) {
  const [content, setContent] = useState("");
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
  const { mutate: postMessage } = useMutation(channelMutations.post());
  const invitations = resolveChannelAudience({
    content,
    sender: { type: "user" },
    members,
    agents,
  }).invitations;
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
    if (!message && attachments.length === 0) return;
    setContent("");
    clearAttachments();
    mention.close();
    onSubmit();
    postMessage({
      id: generateUUID(),
      channelId: channel.id,
      content: message,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
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
          <AgentInvitationChips invitations={invitations} />
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
      </div>
    </form>
  );
}

function channelMentionSuggestions(
  query: string,
  agents: readonly Agent[],
  members: readonly AgentMembership[],
): AgentPickerSuggestion[] {
  const normalizedQuery = query.toLowerCase();
  const suggestions = agentPickerSuggestions({
    query,
    agents,
    memberships: members,
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

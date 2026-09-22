import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { AgentPicker } from "@channels/components/agents/AgentPicker";
import {
  agentPickerSuggestions,
  type AgentPickerSuggestion,
} from "@channels/components/agents/agentPickerSuggestions";
import { useAgentMentionInput } from "@channels/components/agents/useAgentMentionInput";
import {
  agentHandleFromName,
  agentMatchesMentionQuery,
  channelLead,
  type Channel,
  type ChannelMember,
} from "@channels/model";
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
  onSubmit,
}: {
  channel: Channel;
  members: ChannelMember[];
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
  const mention = useAgentMentionInput({
    value: content,
    onValueChange: setContent,
    textareaRef,
    suggestionsFor: (query) => channelMentionSuggestions(query, channel, members),
    channelId: channel.id,
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
            placeholder={`Message #${channel.name}, or @mention an agent`}
            className="max-h-18 min-h-14 overflow-y-auto py-2 text-sm"
            rows={1}
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
  channel: Channel,
  members: readonly ChannelMember[],
): AgentPickerSuggestion[] {
  const normalizedQuery = query.toLowerCase();
  const suggestions = agentPickerSuggestions(query, members);
  const lead = channelLead(channel.leadId);
  if (agentMatchesMentionQuery(lead, query)) {
    suggestions.unshift({
      handle: agentHandleFromName(lead.name),
      name: lead.name,
      description: lead.role,
      group: "Channel",
      avatar: lead.avatar,
    });
  }
  if ("everyone".includes(normalizedQuery)) {
    suggestions.unshift({
      handle: "everyone",
      name: "Everyone",
      description: "Wake everyone in the channel",
      group: "Channel",
      kind: "everyone",
    });
  }
  return suggestions;
}

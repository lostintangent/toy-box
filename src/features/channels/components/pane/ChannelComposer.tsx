import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { AgentPicker } from "@channels/components/agents/AgentPicker";
import {
  agentPickerSuggestions,
  type AgentPickerSuggestion,
} from "@channels/components/agents/agentPickerSuggestions";
import { useAgentCompletions } from "@channels/components/agents/useAgentCompletions";
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
  const attachments = useAttachments();
  const { mutate: postMessage } = useMutation(channelMutations.post());
  const completions = useAgentCompletions({
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
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      {...attachments.dropTargetProps}
    >
      <input {...attachments.fileInputProps} />
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
          placeholder={`Message #${channel.name}, or @mention an agent`}
          className="max-h-18 min-h-14 overflow-y-auto py-2 text-sm"
          rows={1}
        />
        <InputGroupAddon align="block-end" className="relative justify-between px-2 pt-0 pb-2">
          <TypingEffect value={content} />
          <div className="relative flex items-center gap-1">
            <AttachImageButton onClick={attachments.openPicker} />
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

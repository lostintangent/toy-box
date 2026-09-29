import { useRef } from "react";
import { Check, Reply } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentMention } from "@channels/components/agents/AgentMention";
import {
  channelAttachmentPreview,
  channelAudienceLabel,
  DELETED_AGENT_NAME,
  resolveChannelAudience,
  withoutLeadingMentions,
  type ChannelAgent,
  type ChannelConversationMessage,
} from "@channels/model";
import { channelMessageReactions } from "@channels/model/reactions";
import type { ChannelRequestState } from "@channels/model/requests";
import { CopyControl } from "@sessions/components/transcript/messages/UserMessage";
import { AttachmentGallery } from "@/shared/attachments/AttachmentGallery";
import { Button } from "@/shared/ui/button";
import { ClockTime } from "@/shared/ui/clock-time";
import { ShowMore, useShowMore } from "@/shared/ui/show-more";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { WaitingIndicator } from "@/shared/ui/waiting-indicator";
import { cn } from "@/shared/utils";
import { useChannelPane } from "../ChannelPaneContext";
import { ChannelReactions } from "./ChannelReactions";

/** One agent's consecutive messages under a single avatar. */
export function AgentRun({
  agentId,
  messages,
  requests,
}: {
  agentId: string;
  messages: readonly ChannelConversationMessage[];
  /** Request states, by the sequence of the message each references. */
  requests: ReadonlyMap<number, ChannelRequestState>;
}) {
  const { lead, members, agents } = useChannelPane();
  const agent = agents.find(({ id }) => id === agentId);
  // Everyone but the sender reads as "Everyone"; a message that wakes no agent is for the user.
  const addressees = messages.map(({ content, sender }) => {
    const audience = resolveChannelAudience({ content, sender, lead, members });
    return audience.length > 0 ? channelAudienceLabel(audience, agents.length - 1) : undefined;
  });

  return (
    <article className="flex gap-3">
      <AgentAvatar name={agent?.name ?? "?"} avatar={agent?.avatar} />
      <div className="min-w-0 max-w-full space-y-2 @md:max-w-[80%]">
        {messages.map((message, index) => {
          const addressee = addressees[index];
          const request = requests.get(message.sequence);
          return (
            <AgentMessage
              key={message.id}
              message={message}
              author={index === 0 ? (agent?.name ?? DELETED_AGENT_NAME) : undefined}
              addressee={addressee}
              // After the first, a run's headers appear only to say something new.
              showHeader={
                index === 0 || addressee !== addressees[index - 1] || request !== undefined
              }
              request={request}
              agent={agent}
            />
          );
        })}
      </div>
    </article>
  );
}

function AgentMessage({
  message,
  author,
  addressee,
  showHeader,
  request,
  agent,
}: {
  message: ChannelConversationMessage;
  /** Shown on a run's first message. */
  author?: string;
  addressee?: string;
  showHeader: boolean;
  request?: ChannelRequestState;
  /** Absent once the author has been removed from the Channel. */
  agent?: ChannelAgent;
}) {
  const { agents, reply } = useChannelPane();
  const textRef = useRef<HTMLDivElement>(null);
  // Coordination between agents recedes; messages for the user and requests stay whole.
  const { collapsed, clamped, toggle } = useShowMore(
    textRef,
    message.content,
    addressee !== undefined && request === undefined,
  );
  const reactions = channelMessageReactions(message, agents);
  const attachments = message.attachments?.map(channelAttachmentPreview) ?? [];

  return (
    <div className="group/entry">
      {showHeader && (
        <div className="mb-1 flex h-4.5 min-w-0 items-center gap-2 text-xs">
          {author && (
            <span className={cn("shrink-0 font-semibold", !agent && "italic")}>{author}</span>
          )}
          {addressee && (
            <span className="min-w-0 truncate text-muted-foreground">→ {addressee}</span>
          )}
          <ClockTime className="shrink-0 text-2xs text-muted-foreground" date={message.timestamp} />
          {request && <RequestTag state={request} />}
        </div>
      )}
      {message.content && (
        <div className="relative">
          <div
            className={cn(
              "relative rounded-xl border bg-secondary-background px-3.5 py-2.5 text-left text-sm",
              request === "pending" && "border-amber-500/40 ring-[3px] ring-amber-500/10",
            )}
          >
            <div
              ref={textRef}
              className={cn(
                collapsed && "max-h-40 overflow-hidden",
                clamped &&
                  "[mask-image:linear-gradient(to_bottom,black_40%,transparent_calc(100%_-_1.5rem))]",
              )}
            >
              <AgentMention content={withoutLeadingMentions(message.content, agents)} />
            </div>
            {/* Collapsed, the toggle floats over the faded end; expanded, it closes the text. */}
            {toggle && (
              <ShowMore {...toggle} className={cn(clamped && "absolute bottom-2 left-3.5 mt-0")} />
            )}
          </div>
          <div className="pointer-events-none absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within/entry:pointer-events-auto group-focus-within/entry:opacity-100 group-hover/entry:pointer-events-auto group-hover/entry:opacity-100">
            {agent && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Reply to ${agent.name}`}
                      onClick={() => reply(agent)}
                    >
                      <Reply aria-hidden />
                    </Button>
                  }
                />
                <TooltipContent sideOffset={4}>Reply</TooltipContent>
              </Tooltip>
            )}
            <CopyControl content={message.content} />
          </div>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AttachmentGallery attachments={attachments} variant="filmstrip" />
        </div>
      )}
      {reactions.length ? (
        <div className="mt-2">
          <ChannelReactions reactions={reactions} />
        </div>
      ) : null}
    </div>
  );
}

function RequestTag({ state }: { state: ChannelRequestState }) {
  return state === "pending" ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 py-px pr-2 pl-0.5 text-2xs font-medium text-amber-700 dark:text-amber-400">
      <WaitingIndicator className="size-3.5" />
      Needs your reply
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
      <Check className="size-3" />
      Replied
    </span>
  );
}

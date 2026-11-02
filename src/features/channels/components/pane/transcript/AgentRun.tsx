import { useRef } from "react";
import { Check, Reply } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentMentionMarkdown } from "@channels/components/agents/AgentMentionMarkdown";
import type { ChannelAgentIdentity } from "@channels/model";
import { CopyControl } from "@/shared/messages/CopyControl";
import { AttachmentGallery } from "@/shared/attachments/AttachmentGallery";
import { Button } from "@/shared/ui/button";
import { ClockTime } from "@/shared/ui/clock-time";
import { ShowMore, useShowMore } from "@/shared/ui/show-more";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { RunningIndicator, waitingOutlineClassName } from "@/shared/ui/running-indicator";
import { cn } from "@/shared/utils";
import { useChannelPane } from "../ChannelPaneContext";
import { ChannelReactions } from "./ChannelReactions";
import type { AgentRunEntry, ChannelRequestState } from "./transcriptRows";

/** One agent's consecutive messages under a single avatar. */
export function AgentRun({
  agentId,
  entries,
}: {
  agentId: string;
  entries: readonly AgentRunEntry[];
}) {
  const agent = useChannelPane().agent(agentId);

  return (
    <article className="flex gap-3">
      <AgentAvatar agent={agent} />
      <div className="min-w-0 max-w-full space-y-2 @md:max-w-[80%]">
        {entries.map((entry) => (
          <AgentMessage key={entry.message.id} entry={entry} agent={agent} />
        ))}
      </div>
    </article>
  );
}

function AgentMessage({
  entry: { message, body, startsRun, addressee, request, showHeader, collapsible },
  agent,
}: {
  entry: AgentRunEntry;
  agent: ChannelAgentIdentity;
}) {
  const { reply, answer } = useChannelPane();
  const textRef = useRef<HTMLDivElement>(null);
  const { collapsed, clamped, toggle } = useShowMore(textRef, message.content, collapsible);
  const attachments = message.attachments ?? [];

  return (
    <div
      className="group/entry"
      data-request-sequence={request === "pending" ? message.sequence : undefined}
    >
      {showHeader && (
        <div className="mb-1 flex h-4.5 min-w-0 items-center gap-2 text-xs">
          {startsRun && (
            <span className={cn("shrink-0 font-semibold", agent.deleted && "italic")}>
              {agent.name}
            </span>
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
              request === "pending" && waitingOutlineClassName,
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
              <AgentMentionMarkdown content={body} />
            </div>
            {/* Collapsed, the toggle floats over the faded end; expanded, it closes the text. */}
            {toggle && (
              <ShowMore {...toggle} className={cn(clamped && "absolute bottom-2 left-3.5 mt-0")} />
            )}
          </div>
          <div className="pointer-events-none absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within/entry:pointer-events-auto group-focus-within/entry:opacity-100 group-hover/entry:pointer-events-auto group-hover/entry:opacity-100">
            {!agent.deleted && (
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
      {request === "pending" && message.replies && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.replies.map((label) => (
            <Button key={label} variant="outline" size="sm" onClick={() => answer(label)}>
              {label}
            </Button>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AttachmentGallery attachments={attachments} variant="filmstrip" />
        </div>
      )}
      <ChannelReactions message={message} className="mt-2" />
    </div>
  );
}

function RequestTag({ state }: { state: ChannelRequestState }) {
  return state === "pending" ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 py-px pr-2 pl-0.5 text-2xs font-medium text-amber-700 dark:text-amber-400">
      <RunningIndicator waiting className="size-3.5" />
      Needs your reply
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
      <Check className="size-3" />
      Replied
    </span>
  );
}

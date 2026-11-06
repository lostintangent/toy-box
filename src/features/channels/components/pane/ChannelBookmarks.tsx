import { useState } from "react";
import { defaultFilter } from "cmdk";
import { Bookmark, UserRound, X } from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import {
  isChannelSystemMessage,
  type ChannelConversationMessage,
  type ChannelMessage,
} from "@channels/model";
import { notificationPlainText } from "@channels/model/notificationText";
import { outputPillClassName } from "@sessions/components/outputs/ArtifactPill";
import { Button } from "@/shared/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { RelativeTime } from "@/shared/ui/relative-time";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";
import { useChannelPane } from "./ChannelPaneContext";

/** A bookmarked message's icon, in its toggle and in the tray's pill. */
const bookmarkedIconClassName = "fill-current text-blue-500 dark:text-blue-400";

/** Bookmarks or unbookmarks a message, filled blue while it's bookmarked. */
export function BookmarkToggle({ sequence }: { sequence: number }) {
  const { bookmarks, bookmark } = useChannelPane();
  const bookmarked = bookmarks.includes(sequence);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Bookmark message"
            aria-pressed={bookmarked}
            onClick={() => bookmark(sequence, !bookmarked)}
          >
            <Bookmark aria-hidden className={cn(bookmarked && bookmarkedIconClassName)} />
          </Button>
        }
      />
      <TooltipContent sideOffset={4}>{bookmarked ? "Remove bookmark" : "Bookmark"}</TooltipContent>
    </Tooltip>
  );
}

/** The bookmarked messages, newest first. Opening the list loads history through the oldest, so
 *  each previews its message, and selecting one shows it in the transcript. */
export function ChannelBookmarks({
  messages,
  onShow,
  onLoad,
}: {
  messages: readonly ChannelMessage[];
  onShow: (sequence: number) => void;
  onLoad: (throughSequence: number) => void;
}) {
  const { bookmarks } = useChannelPane();
  const [open, setOpen] = useState(false);
  const count = bookmarks.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onLoad(bookmarks[0]!);
      }}
    >
      <PopoverTrigger
        aria-label={`${count} ${count === 1 ? "bookmark" : "bookmarks"}`}
        className={outputPillClassName}
        render={<button type="button" />}
      >
        <Bookmark className={cn("size-3.5 shrink-0", bookmarkedIconClassName)} />
        {count}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-0">
        <Command filter={(_value, search, keywords) => defaultFilter("", search, keywords)}>
          <CommandInput placeholder="Filter bookmarks" />
          <CommandList>
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground italic">
              No matching bookmarks
            </CommandEmpty>
            {[...bookmarks].reverse().map((sequence) => (
              <BookmarkItem
                key={sequence}
                sequence={sequence}
                messages={messages}
                onSelect={() => {
                  setOpen(false);
                  onShow(sequence);
                }}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A bookmark previews its message once its page of history loads. */
function BookmarkItem({
  sequence,
  messages,
  onSelect,
}: {
  sequence: number;
  messages: readonly ChannelMessage[];
  onSelect: () => void;
}) {
  const { agent, bookmark } = useChannelPane();
  const message = messages.find((candidate) => candidate.sequence === sequence);
  const loaded = message && !isChannelSystemMessage(message) ? message : undefined;
  const sender = loaded?.sender.type === "agent" ? agent(loaded.sender.agentId) : undefined;
  const name = sender?.name ?? "You";
  const preview = loaded && messagePreview(loaded);

  return (
    <CommandItem
      value={String(sequence)}
      keywords={loaded ? [name, preview!] : []}
      onSelect={onSelect}
    >
      {sender ? (
        <AgentAvatar agent={sender} className="size-4" />
      ) : loaded ? (
        <UserRound />
      ) : (
        <Bookmark />
      )}
      {loaded ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium">{name}</span>
            <RelativeTime
              className="ms-auto shrink-0 text-xs text-muted-foreground"
              date={loaded.timestamp}
            />
          </div>
          <ScrollableFade className="whitespace-nowrap text-muted-foreground">
            {preview}
          </ScrollableFade>
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground italic">Loading…</span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="-me-1 text-muted-foreground hover:text-foreground"
        aria-label="Remove bookmark"
        onClick={(event) => {
          event.stopPropagation();
          bookmark(sequence, false);
        }}
      >
        <X aria-hidden />
      </Button>
    </CommandItem>
  );
}

function messagePreview({ content, attachments = [] }: ChannelConversationMessage): string {
  const [line] = notificationPlainText(content).split("\n", 1);
  if (line) return line;
  return `${attachments.length} ${attachments.length === 1 ? "attachment" : "attachments"}`;
}

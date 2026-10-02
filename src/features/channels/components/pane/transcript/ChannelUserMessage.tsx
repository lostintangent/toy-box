import { AgentMention } from "@channels/components/agents/AgentMention";
import { channelAttachmentPreview, type ChannelConversationMessage } from "@channels/model";
import { channelMessageReactions } from "@channels/model/reactions";
import { UserMessage } from "@/shared/messages/UserMessage";
import { ClockTime } from "@/shared/ui/clock-time";
import { useChannelPane } from "../ChannelPaneContext";
import { ChannelReactions } from "./ChannelReactions";

/** The user's message, shown as in a session, with the reactions agents gave it. */
export function ChannelUserMessage({ message }: { message: ChannelConversationMessage }) {
  const { agents } = useChannelPane();
  const reactions = channelMessageReactions(message, agents);

  return (
    <UserMessage
      message={{ ...message, attachments: message.attachments?.map(channelAttachmentPreview) }}
      time={<ClockTime className="text-xs text-muted-foreground" date={message.timestamp} />}
      extraActions={
        reactions.length ? (
          <div className="mr-1">
            <ChannelReactions reactions={reactions} />
          </div>
        ) : undefined
      }
    >
      <AgentMention content={message.content} onAccent />
    </UserMessage>
  );
}

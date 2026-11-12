import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import type { Channel } from "@channels/model";
import { cn } from "@/shared/utils";

/** Lucide's hash, on the cyan every channel wore before it had an avatar. */
const CHANNEL_MARK = {
  mark: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  color: "#0891b2",
  ink: "#fff",
};

/** A Channel's avatar in its rounded square: its image, or its mark, or the hash when it has
 *  neither. */
export function ChannelAvatar({
  avatar,
  className,
}: {
  avatar?: Channel["avatar"];
  className?: string;
}) {
  if (avatar && "image" in avatar) {
    return (
      <img
        src={avatar.image}
        alt=""
        aria-hidden
        className={cn(
          "inline-block size-8 shrink-0 rounded-[26%] object-cover outline -outline-offset-1 outline-foreground/10",
          className,
        )}
      />
    );
  }
  return (
    <AgentAvatar
      agent={{ name: "#", avatar: avatar ?? CHANNEL_MARK }}
      className={cn("rounded-[26%]", className)}
    />
  );
}

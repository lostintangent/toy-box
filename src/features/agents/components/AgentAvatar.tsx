import type { AgentAvatar as AgentAvatarValue } from "@agents/model";
import { cn } from "@/shared/utils";

/** Render an Agent-authored vector mark inside the shared avatar frame. */
export function AgentAvatar({
  name,
  avatar,
  className,
}: {
  name: string;
  avatar?: AgentAvatarValue;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full",
        !avatar && "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
        className,
      )}
      style={
        avatar
          ? { backgroundColor: avatar.color, color: `contrast-color(${avatar.color})` }
          : undefined
      }
      aria-hidden
    >
      {avatar ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-[64%]"
        >
          <path d={avatar.mark} />
        </svg>
      ) : (
        <span className="text-[0.7em] font-bold">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

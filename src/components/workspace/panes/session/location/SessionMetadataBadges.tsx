import { MessagesSquare } from "lucide-react";
import { MetadataBadge } from "@/components/ui/metadata-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SessionLocationIcon } from "./SessionLocationIcon";
import { resolveSessionLocation } from "./locationDisplay";

type SessionMetadataBadgesProps = {
  repository?: string;
  gitRoot?: string;
  cwd?: string;
  messageCount?: number;
  isWorktree?: boolean;
  className?: string;
};

export function SessionMetadataBadges({
  repository,
  gitRoot,
  cwd,
  messageCount,
  isWorktree = false,
  className,
}: SessionMetadataBadgesProps) {
  const location = resolveSessionLocation({ repository, gitRoot, cwd });
  const hasMessageCount = typeof messageCount === "number" && messageCount > 0;
  if (!location && !hasMessageCount) return null;

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {location && (
        <Tooltip>
          <TooltipTrigger asChild>
            <MetadataBadge className="max-w-44" aria-label={location.description}>
              <SessionLocationIcon
                kind={location.kind}
                isWorktree={isWorktree}
                className="h-3 w-3 shrink-0"
              />
              <span className="truncate">{location.label}</span>
            </MetadataBadge>
          </TooltipTrigger>
          <TooltipContent sideOffset={6} className="max-w-96 break-all">
            {location.tooltip}
          </TooltipContent>
        </Tooltip>
      )}

      {hasMessageCount && (
        <MetadataBadge aria-label={`${messageCount} messages`}>
          <MessagesSquare className="h-3 w-3 shrink-0" />
          <span>{messageCount}</span>
        </MetadataBadge>
      )}
    </div>
  );
}

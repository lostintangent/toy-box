import { MessagesSquare } from "lucide-react";
import { MetadataBadge } from "@/shared/components/ui/metadata-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import { SessionLocationIcon } from "./SessionLocationIcon";
import { resolveSessionLocation } from "./locationDisplay";
import { useSessionContext } from "./useSessionContext";

type SessionMetadataBadgesProps = {
  cwd?: string;
  repository?: string;
  gitRoot?: string;
  messageCount?: number;
  isWorktree?: boolean;
  className?: string;
};

export function SessionMetadataBadges({
  cwd,
  repository,
  gitRoot,
  messageCount,
  isWorktree = false,
  className,
}: SessionMetadataBadgesProps) {
  const { context, error } = useSessionContext({ directory: cwd, repository, gitRoot });
  const location = resolveSessionLocation({
    repository: context.repository,
    gitRoot: context.gitRoot,
    cwd: context.directory,
  });
  const hasMessageCount = typeof messageCount === "number" && messageCount > 0;
  if (!location && !hasMessageCount) return null;

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {location && (
        <Tooltip>
          <TooltipTrigger
            render={
              <MetadataBadge
                className="max-w-44"
                aria-label={location.description}
                aria-description={error?.message}
              >
                <SessionLocationIcon
                  kind={location.kind}
                  isWorktree={isWorktree}
                  className="h-3 w-3 shrink-0"
                />
                <span className="truncate">{location.label}</span>
              </MetadataBadge>
            }
          />
          <TooltipContent sideOffset={6} className="max-w-96 break-all">
            {location.tooltip}
            {error && <p>Repository information unavailable: {error.message}</p>}
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

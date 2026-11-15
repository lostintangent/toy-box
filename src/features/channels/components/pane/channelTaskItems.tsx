import { Clock3, FileText, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import {
  channelAgentIdentity,
  channelTaskElapsedMinutes,
  channelTasksDiff,
  type ChannelAgent,
  type ChannelArtifact,
  type ChannelTask,
} from "@channels/model";
import type { DiffStats } from "@/shared/diffStats";
import { Button } from "@/shared/ui/button";
import type { ChecklistItem } from "@/shared/ui/checklist";
import { PopoverClose } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const DIFF_COUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function useChannelTaskItems(options: Parameters<typeof channelTaskItems>[0]) {
  const [now, setNow] = useState(Date.now);
  const started = options.tasks.some(function hasStart(task): boolean {
    return Boolean(task.startedAt) || Boolean(task.children?.some(hasStart));
  });
  useEffect(() => {
    if (!started) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [started]);
  return channelTaskItems(options, now);
}

/** Both Channel checklists present the same task identities, owners, and linked outcomes. */
export function channelTaskItems(
  {
    tasks,
    owners,
    artifacts,
    onArtifactOpen,
    closeOnArtifactOpen = false,
  }: {
    tasks: readonly ChannelTask[];
    owners: readonly ChannelAgent[];
    artifacts: readonly ChannelArtifact[];
    onArtifactOpen: (artifact: ChannelArtifact) => void;
    closeOnArtifactOpen?: boolean;
  },
  now = Date.now(),
): ChecklistItem[] {
  return tasks.map((task) => {
    const elapsed = channelTaskElapsedMinutes(task, now);
    const remaining =
      task.status === "in_progress" && task.checkInAt
        ? Math.max(0, Math.ceil((Date.parse(task.checkInAt) - now) / 60_000))
        : undefined;
    const ageLabel =
      elapsed === undefined
        ? undefined
        : `${elapsed} ${elapsed === 1 ? "minute" : "minutes"} elapsed${remaining === undefined ? "" : `, check-in in ${remaining}m`}`;
    const diff = task.status === "pending" ? undefined : channelTasksDiff([task]);
    const artifact = task.artifactId
      ? artifacts.find(({ id }) => id === task.artifactId)
      : undefined;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      detail:
        diff || task.ownerId || task.artifactId || elapsed !== undefined ? (
          <span className="inline-flex items-center gap-[9px]">
            {elapsed !== undefined && (
              <time
                dateTime={task.startedAt}
                aria-label={ageLabel}
                title={ageLabel}
                suppressHydrationWarning
                className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums italic text-muted-foreground"
              >
                <Clock3 aria-hidden className="size-3 shrink-0" />
                {elapsed}m{remaining === undefined ? "" : ` / ${remaining}m`}
              </time>
            )}
            {diff && <TaskDiff diff={diff} />}
            {task.artifactId && (
              <TaskArtifact
                artifact={artifact}
                onOpen={onArtifactOpen}
                closeOnOpen={closeOnArtifactOpen}
              />
            )}
            {task.ownerId && <TaskOwner ownerId={task.ownerId} owners={owners} />}
          </span>
        ) : undefined,
      children:
        task.children &&
        channelTaskItems(
          {
            tasks: task.children,
            owners,
            artifacts,
            onArtifactOpen,
            closeOnArtifactOpen,
          },
          now,
        ),
    };
  });
}

export function TaskDiff({ diff }: { diff: DiffStats }) {
  const label = `${diff.added} lines added, ${diff.removed} lines removed`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex gap-[5px] font-mono text-2xs tabular-nums in-data-[slot=checklist-popup]:text-[10.5px]"
    >
      <span aria-hidden className="text-diff-added">
        +{DIFF_COUNT_FORMATTER.format(diff.added)}
      </span>
      <span aria-hidden className="text-diff-removed">
        {`\u2212${DIFF_COUNT_FORMATTER.format(diff.removed)}`}
      </span>
    </span>
  );
}

function TaskArtifact({
  artifact,
  onOpen,
  closeOnOpen,
}: {
  artifact?: ChannelArtifact;
  onOpen: (artifact: ChannelArtifact) => void;
  closeOnOpen: boolean;
}) {
  const label = artifact ? `Open ${artifact.title}` : "Artifact unavailable";
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="-m-1 text-muted-foreground"
      aria-label={label}
      title={artifact?.title ?? label}
      disabled={!artifact}
      onClick={artifact ? () => onOpen(artifact) : undefined}
    >
      <FileText aria-hidden className="size-3.5" />
    </Button>
  );
  return closeOnOpen ? <PopoverClose render={button} /> : button;
}

/** A task's owner: an agent by its avatar, or the user as You. */
function TaskOwner({ ownerId, owners }: { ownerId: string; owners: readonly ChannelAgent[] }) {
  const owner = ownerId === "user" ? undefined : channelAgentIdentity(owners, ownerId);
  const name = owner?.name ?? "You";
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label={name} className="inline-flex" />}>
        {owner ? (
          <AgentAvatar agent={owner} className="size-4 in-data-[slot=checklist-popup]:size-3.5" />
        ) : (
          <UserRound className="size-4 text-muted-foreground in-data-[slot=checklist-popup]:size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>{name}</TooltipContent>
    </Tooltip>
  );
}

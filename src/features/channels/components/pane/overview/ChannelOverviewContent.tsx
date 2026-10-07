import { useRef, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronRight,
  Clock3,
  ExternalLink,
  MonitorPlay,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
  UserMinus,
} from "lucide-react";
import { AgentItem } from "@channels/components/agents/AgentItem";
import {
  channelTasksDiff,
  type Channel,
  type ChannelArtifact,
  type ChannelMember,
  type ChannelRoutine,
} from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { ArtifactPill } from "@workspace/components/outputs/ArtifactPill";
import { SessionMetadataBadges } from "@sessions/components/location/SessionMetadataBadges";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Checklist } from "@/shared/ui/checklist";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SectionHeading } from "@/shared/ui/section-heading";
import { RelativeTime } from "@/shared/ui/relative-time";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { ShowMore, useShowMore } from "@/shared/ui/show-more";
import { nextCronOccurrence } from "@/shared/cron";
import { cn } from "@/shared/utils";
import { useChannelPane } from "../ChannelPaneContext";
import { channelTaskItems, TaskDiff } from "../channelTaskItems";

/** What the overview shows: the Channel's context, team members, tasks, artifacts, and routines. */
export function ChannelOverviewContent({
  channel,
  artifacts,
  routines,
  onArtifactOpen,
  onEditMember,
  onRemoveMember,
  onAddAgent,
  onBrowseDirectory,
}: {
  channel: Channel;
  artifacts: ChannelArtifact[];
  routines: ChannelRoutine[];
  onArtifactOpen: (artifact: ChannelArtifact) => void;
  onEditMember: (member: ChannelMember) => void;
  onRemoveMember: (member: ChannelMember) => void;
  onAddAgent: () => void;
  onBrowseDirectory: () => void;
}) {
  const { lead, members, agents } = useChannelPane();
  const sortedMembers = [...members].sort((left, right) => left.name.localeCompare(right.name));
  const completedCount = channel.tasks.filter(({ status }) => status === "done").length;
  const diff = channelTasksDiff(channel.tasks);

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-panel p-4">
      <div className="space-y-3">
        {channel.purpose ? (
          <ChannelPurpose purpose={channel.purpose} />
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground italic">
            No purpose defined yet.
          </p>
        )}
        {channel.directory && (
          <button
            type="button"
            aria-label={`Browse ${channel.directory}`}
            className="flex max-w-full rounded-full outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onBrowseDirectory}
          >
            <SessionMetadataBadges cwd={channel.directory} />
          </button>
        )}
        {channel.previewUrl && (
          <a
            href={channel.previewUrl}
            target="_blank"
            rel="noreferrer"
            title={channel.previewUrl}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "flex w-full min-w-0 justify-start font-normal",
            )}
          >
            <MonitorPlay />
            <span className="font-medium">Preview</span>
            <ScrollableFade className="min-w-0 flex-1 whitespace-nowrap text-left text-muted-foreground">
              <span className="shrink-0">{channel.previewUrl}</span>
            </ScrollableFade>
            <ExternalLink />
          </a>
        )}
      </div>

      <OverviewSection title="Team members" count={members.length + 1}>
        <div>
          <div role="list" aria-label={`Team members in #${channel.name}`}>
            <AgentItem agent={lead} action={<RowMenu name={lead.name} />} />
            {sortedMembers.map((member) => (
              <AgentItem
                key={member.id}
                agent={member}
                action={
                  <RowMenu name={member.name}>
                    <DropdownMenuItem onClick={() => onEditMember(member)}>
                      <Pencil /> Edit member
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => onRemoveMember(member)}>
                      <UserMinus /> Remove from channel
                    </DropdownMenuItem>
                  </RowMenu>
                }
              />
            ))}
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={onAddAgent}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-current/40">
              <Plus className="size-3" />
            </span>
            Add an agent
          </button>
        </div>
      </OverviewSection>

      <OverviewSection
        title="Task list"
        count={`${completedCount}/${channel.tasks.length}`}
        detail={diff && <TaskDiff diff={diff} />}
      >
        {channel.tasks.length > 0 ? (
          <Checklist
            items={channelTaskItems({
              tasks: channel.tasks,
              owners: agents,
              artifacts,
              onArtifactOpen,
            })}
            className="text-sm"
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">No tasks yet.</p>
        )}
      </OverviewSection>

      <OverviewSection title="Artifacts" count={artifacts.length}>
        {artifacts.length > 0 ? (
          <div role="list" aria-label={`Artifacts in #${channel.name}`} className="flex flex-col">
            {artifacts.map((artifact) => (
              <ArtifactPill
                key={artifact.id}
                file={artifact.file}
                label={artifact.title}
                detail={<RelativeTime className="text-muted-foreground" date={artifact.sharedAt} />}
                className="w-full text-foreground"
                onClick={() => onArtifactOpen(artifact)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No artifacts shared yet.</p>
        )}
      </OverviewSection>

      <OverviewSection title="Routines" count={routines.length}>
        {routines.length > 0 ? (
          <div role="list" aria-label={`Routines in #${channel.name}`} className="space-y-2">
            {routines.map((routine) => (
              <RoutineItem key={routine.id} channelId={channel.id} routine={routine} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No routines scheduled yet.</p>
        )}
      </OverviewSection>
    </div>
  );
}

/** A routine's title and next run, expanding to its prompt. Only the lead adds or changes one;
 *  you can run or delete it. */
function RoutineItem({ channelId, routine }: { channelId: string; routine: ChannelRoutine }) {
  const { mutate: runRoutine } = useMutation(channelMutations.runRoutine(channelId));
  const { mutate: deleteRoutine } = useMutation(channelMutations.deleteRoutine(channelId));

  return (
    <div role="listitem" className="flex items-start gap-2 text-sm">
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
          <span className="flex min-w-0 flex-col items-start gap-1">
            <span className="text-foreground/90">{routine.title}</span>
            <Badge variant="metadata" title={routine.schedule}>
              <Clock3 className="h-3 w-3 shrink-0" />
              <RelativeTime date={nextCronOccurrence(routine.schedule, new Date())} />
            </Badge>
          </span>
        </summary>
        <p className="mt-1.5 ml-5.5 whitespace-pre-wrap text-xs text-muted-foreground">
          {routine.prompt}
        </p>
      </details>
      <RowMenu name={routine.title}>
        <DropdownMenuItem onClick={() => runRoutine(routine.id)}>
          <Play /> Run routine
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => deleteRoutine(routine.id)}>
          <Trash2 /> Delete routine
        </DropdownMenuItem>
      </RowMenu>
    </div>
  );
}

/** The purpose, clamped to three lines until the reader expands it. */
function ChannelPurpose({ purpose }: { purpose: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const { collapsed, toggle } = useShowMore(textRef, purpose);

  return (
    <div>
      <p
        ref={textRef}
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed text-foreground/90",
          collapsed && "line-clamp-3",
        )}
      >
        {purpose}
      </p>
      {toggle && <ShowMore {...toggle} />}
    </div>
  );
}

/** A row's "⋯" menu. The lead can't be edited or removed, so its menu has no actions and stays
 *  disabled, keeping every row the same shape. */
function RowMenu({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!children}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Actions for ${name}`}
            title={`Actions for ${name}`}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      {children && <DropdownMenuContent align="end">{children}</DropdownMenuContent>}
    </DropdownMenu>
  );
}

function OverviewSection({
  title,
  count,
  detail,
  children,
}: {
  title: string;
  count: number | string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 not-first-of-type:border-t not-first-of-type:pt-6">
      <SectionHeading title={title} count={count} detail={detail} />
      {children}
    </section>
  );
}

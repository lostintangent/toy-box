import { useRef, type ReactNode } from "react";
import { ExternalLink, MonitorPlay, MoreHorizontal, Pencil, Plus, UserMinus } from "lucide-react";
import { AgentItem } from "@channels/components/agents/AgentItem";
import type { Channel, ChannelArtifact, ChannelMember } from "@channels/model";
import { workspaceFileId } from "@files/model";
import { ArtifactPill } from "@sessions/components/composer/ArtifactPill";
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
import { ProgressBar } from "@/shared/ui/progress-bar";
import { RelativeTime } from "@/shared/ui/relative-time";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { ShowMore, useShowMore } from "@/shared/ui/show-more";
import { cn } from "@/shared/utils";
import { useChannelPane } from "../ChannelPaneContext";
import { channelChecklistItems } from "../channelChecklistItems";

/** What the overview shows: the Channel's context, agents, shared artifacts, and checklist. */
export function ChannelOverviewContent({
  channel,
  artifacts,
  onArtifactOpen,
  onEditMember,
  onRemoveMember,
  onAddAgent,
  onBrowseDirectory,
}: {
  channel: Channel;
  artifacts: ChannelArtifact[];
  onArtifactOpen: (artifact: ChannelArtifact) => void;
  onEditMember: (member: ChannelMember) => void;
  onRemoveMember: (member: ChannelMember) => void;
  onAddAgent: () => void;
  onBrowseDirectory: () => void;
}) {
  const { lead, members, agents } = useChannelPane();
  const sortedMembers = [...members].sort((left, right) => left.name.localeCompare(right.name));
  const completedCount = channel.checklist.filter(({ status }) => status === "done").length;

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

      <OverviewSection title="Agents" count={members.length + 1}>
        <div>
          <div role="list" aria-label={`Agents in #${channel.name}`}>
            <AgentItem agent={lead} action={<MemberMenu name={lead.name} />} />
            {sortedMembers.map((member) => (
              <AgentItem
                key={member.id}
                agent={member}
                action={
                  <MemberMenu name={member.name}>
                    <DropdownMenuItem onClick={() => onEditMember(member)}>
                      <Pencil /> Edit member
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => onRemoveMember(member)}>
                      <UserMinus /> Remove from channel
                    </DropdownMenuItem>
                  </MemberMenu>
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

      <OverviewSection title="Artifacts" count={artifacts.length}>
        {artifacts.length > 0 ? (
          <div role="list" aria-label={`Artifacts in #${channel.name}`} className="flex flex-col">
            {artifacts.map((artifact) => (
              <ArtifactPill
                key={workspaceFileId(artifact.file)}
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

      <OverviewSection
        title="Checklist"
        count={channel.checklist.length && `${completedCount}/${channel.checklist.length}`}
        progress={
          channel.checklist.length > 0 ? completedCount / channel.checklist.length : undefined
        }
      >
        {channel.checklist.length > 0 ? (
          <Checklist items={channelChecklistItems(channel.checklist, agents)} className="text-sm" />
        ) : (
          <p className="text-sm text-muted-foreground italic">The checklist is empty.</p>
        )}
      </OverviewSection>
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

/** A member's "⋯" menu. The lead can't be edited or removed, so its menu has no actions and stays
 *  disabled, keeping every row the same shape. */
function MemberMenu({ name, children }: { name: string; children?: ReactNode }) {
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
  progress,
  children,
}: {
  title: string;
  /** Hidden when zero, since the section's empty state already says so. */
  count?: number | string;
  /** Completion from 0 to 1, shown as a bar at the heading's end. */
  progress?: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 not-first-of-type:border-t not-first-of-type:pt-6">
      <h3 className="flex h-4.5 items-center gap-1.5">
        <span className="section-heading">{title}</span>
        {count ? <Badge variant="count">{count}</Badge> : null}
        {progress !== undefined && <ProgressBar value={progress} className="ml-auto" />}
      </h3>
      {children}
    </section>
  );
}

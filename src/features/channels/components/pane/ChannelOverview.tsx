import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleSlash,
  ExternalLink,
  FilePenLine,
  Files,
  Hash,
  ListTodo,
  Loader2,
  MonitorPlay,
  PanelRightClose,
  Pin,
  PinOff,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AgentAvatar } from "@channels/components/agents/AgentAvatar";
import { AgentEditor } from "@channels/components/agents/AgentEditor";
import { AgentItem } from "@channels/components/agents/AgentItem";
import type {
  Channel,
  ChannelAgent,
  ChannelArtifact,
  ChannelLead,
  ChannelMember,
  ChannelChecklistItem,
  ChannelChecklistItemStatus,
} from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { useEditorDisplay } from "@files/components/editor/kinds";
import { workspaceFileId } from "@files/model";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { PaneActions } from "@workspace/components/panes/shell/PaneSlots";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
} from "@workspace/components/panes/shell/paneControls";
import { Button, buttonVariants } from "@/shared/ui/button";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/shared/ui/sheet";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import { cn } from "@/shared/utils";
import { DeleteChannelDialog } from "../DeleteChannelDialog";

const CHECKLIST_STATUS: Record<
  ChannelChecklistItemStatus,
  { icon: LucideIcon; iconClassName: string; label: string }
> = {
  pending: {
    icon: Circle,
    iconClassName: "text-muted-foreground [stroke-dasharray:3_3]",
    label: "Pending",
  },
  in_progress: {
    icon: Loader2,
    iconClassName: "animate-spin text-primary",
    label: "In progress",
  },
  blocked: { icon: CircleSlash, iconClassName: "text-destructive", label: "Blocked" },
  done: {
    icon: CircleCheck,
    iconClassName:
      "fill-green-500 text-black [&>circle]:stroke-green-500 [&>path]:origin-center [&>path]:scale-125",
    label: "Done",
  },
};

const OVERVIEW_WIDTH = 320;

/** The Channel's current purpose, progress, shared work, and roster. */
export function ChannelOverview({
  channel,
  lead,
  members,
  artifacts,
  variant,
}: {
  channel: Channel;
  lead: ChannelLead;
  members: ChannelMember[];
  artifacts: ChannelArtifact[];
  variant: PaneVariant;
}) {
  const { toggleFile } = useWorkspaceSurface();
  const overviewRef = useRef<HTMLDivElement>(null);
  const [presentation, setPresentation] = useState<"closed" | "sheet" | "pinned">("closed");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingMember, setEditingMember] = useState<ChannelMember>();
  const [removingMember, setRemovingMember] = useState<ChannelMember>();
  const sortedMembers = [...members].sort((left, right) => left.name.localeCompare(right.name));
  const canPin = variant === "normal";
  const isPinned = presentation === "pinned" && canPin;
  const openLabel = `Open #${channel.name} overview`;
  const trigger = canPin ? (
    <button
      type="button"
      aria-label={openLabel}
      title={openLabel}
      className={PANE_OVERLAY_BUTTON_CLASS}
    >
      <Hash className={PANE_OVERLAY_ICON_CLASS} />
    </button>
  ) : (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={openLabel} title={openLabel}>
      <Hash />
    </Button>
  );

  function openArtifact(artifact: ChannelArtifact) {
    setPresentation("closed");
    toggleFile?.(artifact.file);
  }

  function openMemberEditor(member: ChannelMember) {
    setPresentation("closed");
    setEditingMember(member);
  }

  function openRemoveMemberDialog(member: ChannelMember) {
    setPresentation("closed");
    setRemovingMember(member);
  }

  function openDeleteDialog() {
    setPresentation("closed");
    setConfirmingDelete(true);
  }

  const overviewContent = (
    <ChannelOverviewContent
      channel={channel}
      lead={lead}
      members={sortedMembers}
      artifacts={artifacts}
      onArtifactOpen={openArtifact}
      onEditMember={openMemberEditor}
      onRemoveMember={openRemoveMemberDialog}
      onDelete={openDeleteDialog}
    />
  );

  return (
    <>
      <PaneActions>
        {!isPinned && (
          <Sheet
            open={presentation === "sheet"}
            onOpenChange={(open) => setPresentation(open ? "sheet" : "closed")}
          >
            <SheetTrigger render={trigger} />
            <SheetContent
              ref={overviewRef}
              initialFocus={overviewRef}
              showCloseButton={false}
              style={canPin ? { width: OVERVIEW_WIDTH } : undefined}
              className="w-[92%] gap-0 overflow-hidden p-0 sm:max-w-md"
            >
              <OverviewHeader
                actions={
                  <>
                    {canPin && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Pin overview"
                        title="Pin overview"
                        onClick={() => setPresentation("pinned")}
                      >
                        <Pin />
                      </Button>
                    )}
                    <SheetClose
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Close overview"
                          title="Close overview"
                        />
                      }
                    >
                      <PanelRightClose />
                    </SheetClose>
                  </>
                }
              >
                <SheetTitle>{channel.name}</SheetTitle>
              </OverviewHeader>

              {overviewContent}
            </SheetContent>
          </Sheet>
        )}
      </PaneActions>

      {/* Closing animates the rail. Switching to the Sheet replaces it immediately. */}
      {presentation !== "sheet" && (
        <AnimatePresence>
          {isPinned && (
            <m.aside
              key="channel-overview"
              aria-label={`#${channel.name} overview`}
              style={{ width: OVERVIEW_WIDTH }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="col-start-2 row-span-2 row-start-1 min-h-0 overflow-hidden"
            >
              <div
                className="flex h-full flex-col border-l bg-background"
                style={{ width: OVERVIEW_WIDTH }}
              >
                <OverviewHeader
                  actions={
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Unpin overview"
                        title="Unpin overview"
                        onClick={() => setPresentation("sheet")}
                      >
                        <PinOff />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close overview"
                        title="Close overview"
                        onClick={() => setPresentation("closed")}
                      >
                        <PanelRightClose />
                      </Button>
                    </>
                  }
                >
                  <h2 className="font-semibold text-foreground">{channel.name}</h2>
                </OverviewHeader>

                {overviewContent}
              </div>
            </m.aside>
          )}
        </AnimatePresence>
      )}

      {editingMember && (
        <AgentEditor agent={editingMember} onClose={() => setEditingMember(undefined)} />
      )}
      {confirmingDelete && (
        <DeleteChannelDialog channel={channel} onOpenChange={setConfirmingDelete} />
      )}
      {removingMember && (
        <DestructiveConfirmationDialog
          key={removingMember.id}
          title={`Remove ${removingMember.name}?`}
          description={`This removes ${removingMember.name} from #${channel.name} and deletes their private channel session. Their messages and reactions remain attributed to Deleted agent.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          mutation={channelMutations.removeMember(removingMember.id)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setRemovingMember(undefined);
          }}
        />
      )}
    </>
  );
}

function OverviewHeader({ actions, children }: { actions: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b px-2.5 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center">{actions}</div>
    </div>
  );
}

function ChannelOverviewContent({
  channel,
  lead,
  members,
  artifacts,
  onArtifactOpen,
  onEditMember,
  onRemoveMember,
  onDelete,
}: {
  channel: Channel;
  lead: ChannelLead;
  members: ChannelMember[];
  artifacts: ChannelArtifact[];
  onArtifactOpen: (artifact: ChannelArtifact) => void;
  onEditMember: (member: ChannelMember) => void;
  onRemoveMember: (member: ChannelMember) => void;
  onDelete: () => void;
}) {
  const completedCount = channel.checklist.filter(({ status }) => status === "done").length;

  return (
    <>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-panel p-4">
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-relaxed",
            channel.purpose ? "text-foreground/90" : "text-muted-foreground italic",
          )}
        >
          {channel.purpose ?? "No purpose defined yet."}
        </p>

        <OverviewSection title={`Members (${members.length})`} icon={Users}>
          {members.length > 0 ? (
            <div role="list" aria-label={`Members in #${channel.name}`}>
              {members.map((member) => (
                <AgentItem
                  key={member.id}
                  agent={member}
                  action={
                    <div className="flex items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${member.name}`}
                        title={`Edit ${member.name}`}
                        onClick={() => onEditMember(member)}
                      >
                        <FilePenLine />
                      </Button>
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={`Remove ${member.name} from #${channel.name}`}
                        title={`Remove ${member.name}`}
                        onClick={() => onRemoveMember(member)}
                      >
                        <X />
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Add members by @mentioning them.</p>
          )}
        </OverviewSection>

        <div className="border-t" />

        <OverviewSection
          title={`Checklist${channel.checklist.length > 0 ? ` (${completedCount}/${channel.checklist.length})` : ""}`}
          icon={ListTodo}
        >
          {channel.checklist.length > 0 ? (
            <ChannelChecklist items={channel.checklist} owners={[lead, ...members]} />
          ) : (
            <p className="text-sm text-muted-foreground italic">The checklist is empty.</p>
          )}
        </OverviewSection>

        <div className="border-t" />

        <OverviewSection title={`Artifacts (${artifacts.length})`} icon={Files}>
          {artifacts.length > 0 ? (
            <div role="list" aria-label={`Artifacts in #${channel.name}`}>
              {artifacts.map((artifact) => (
                <ChannelArtifactItem
                  key={workspaceFileId(artifact.file)}
                  artifact={artifact}
                  onOpen={() => onArtifactOpen(artifact)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No artifacts shared yet.</p>
          )}
        </OverviewSection>

        <OverviewSection title="Preview" icon={MonitorPlay}>
          {channel.previewUrl ? (
            <a
              href={channel.previewUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "flex w-full min-w-0 justify-start font-normal",
              )}
            >
              <MonitorPlay />
              <ScrollableFade className="min-w-0 flex-1 whitespace-nowrap text-left">
                <span className="shrink-0">{channel.previewUrl}</span>
              </ScrollableFade>
              <ExternalLink />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground italic">No preview published yet.</p>
          )}
        </OverviewSection>
      </div>

      <div className="border-t px-2.5 py-3">
        <Button
          type="button"
          variant="destructive-ghost"
          size="sm"
          className="w-full justify-start"
          onClick={onDelete}
        >
          <Trash2 /> Delete channel
        </Button>
      </div>
    </>
  );
}

function OverviewSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function ChannelChecklist({
  items,
  owners,
  nested = false,
}: {
  items: readonly ChannelChecklistItem[];
  owners: readonly ChannelAgent[];
  nested?: boolean;
}) {
  return (
    <ul className={cn("space-y-2", nested && "ml-2 border-l pl-4")}>
      {items.map((item) => (
        <ChannelChecklistItemView
          key={`${item.title}:${item.ownerId ?? ""}:${item.status}`}
          item={item}
          owners={owners}
        />
      ))}
    </ul>
  );
}

function ChannelChecklistItemView({
  item,
  owners,
}: {
  item: ChannelChecklistItem;
  owners: readonly ChannelAgent[];
}) {
  const children = item.children ?? [];
  const [expanded, setExpanded] = useState(item.status !== "done");
  const status = CHECKLIST_STATUS[item.status];
  const StatusIcon = status.icon;
  const owner = item.ownerId ? owners.find(({ id }) => id === item.ownerId) : undefined;

  return (
    <li className="space-y-2">
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <StatusIcon
          className={cn("mt-0.5 size-4 shrink-0", status.iconClassName)}
          aria-label={status.label}
        />
        <div className="min-w-0 flex-1">
          {children.length > 0 ? (
            <button
              type="button"
              className="flex w-full min-w-0 items-start gap-1 text-left"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 leading-snug",
                  item.status === "done" && "text-muted-foreground line-through",
                )}
              >
                {item.title}
              </span>
              <ChevronRight
                className={cn(
                  "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
            </button>
          ) : (
            <p
              className={cn(
                "leading-snug",
                item.status === "done" && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </p>
          )}
          {item.ownerId && (
            <div className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
              {owner && <AgentAvatar name={owner.name} avatar={owner.avatar} className="size-4" />}
              <span className={cn(!owner && "italic")}>{owner?.name ?? "Deleted agent"}</span>
            </div>
          )}
        </div>
      </div>
      {expanded && children.length > 0 && (
        <ChannelChecklist items={children} owners={owners} nested />
      )}
    </li>
  );
}

function ChannelArtifactItem({
  artifact,
  onOpen,
}: {
  artifact: ChannelArtifact;
  onOpen: () => void;
}) {
  const { file } = artifact;
  const { Icon } = useEditorDisplay(file);

  return (
    <Button
      type="button"
      title={file.path}
      variant="ghost"
      size="sm"
      className="w-full justify-start font-normal"
      onClick={onOpen}
    >
      <Icon />
      <ScrollableFade className="whitespace-nowrap text-left text-xs font-normal">
        <span className="shrink-0">{artifact.title}</span>
      </ScrollableFade>
    </Button>
  );
}

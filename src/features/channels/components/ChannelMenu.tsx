import { useState } from "react";
import { FilePenLine, Trash2, Users, X } from "lucide-react";
import { AgentEditor } from "@agents/components/AgentEditor";
import { AgentMembershipItem } from "@agents/components/AgentMembershipItem";
import type { Agent } from "@agents/model";
import type { Channel, ChannelArtifact, ChannelMember } from "@channels/model";
import { useEditorDisplay } from "@files/components/editor/kinds";
import { workspaceFileId } from "@files/model";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import type { PaneVariant } from "@workspace/components/panes/WorkspacePaneView";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
} from "@workspace/components/panes/shell/paneControls";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { MetadataBadge } from "@/shared/components/ui/metadata-badge";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import { channelMutations } from "@channels/mutations";
import { DeleteChannelDialog } from "./DeleteChannelDialog";

/** Channel membership, artifacts, and destructive pane actions. */
export function ChannelMenu({
  channel,
  members,
  agents,
  artifacts,
  variant,
}: {
  channel: Channel;
  members: ChannelMember[];
  agents: Agent[];
  artifacts: ChannelArtifact[];
  variant: PaneVariant;
}) {
  const { toggleFile } = useWorkspaceSurface();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string>();
  const [removingMember, setRemovingMember] = useState<ChannelMember>();
  const memberAgents = members
    .map((membership) => ({
      membership,
      agent: agents.find(({ id }) => id === membership.agentId)!,
    }))
    .sort((left, right) => left.agent.name.localeCompare(right.agent.name));
  const removingAgent = removingMember
    ? agents.find(({ id }) => id === removingMember.agentId)
    : undefined;
  const label = `${members.length} ${members.length === 1 ? "agent" : "agents"} in #${channel.title}`;
  const trigger =
    variant === "normal" ? (
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(PANE_OVERLAY_BUTTON_CLASS, "flex items-center gap-1.5 text-xs")}
      >
        <Users className={PANE_OVERLAY_ICON_CLASS} />
        <span className="tabular-nums">{members.length}</span>
      </button>
    ) : (
      <MetadataBadge
        render={<button type="button" aria-label={label} title={label} />}
        className="cursor-pointer select-none hover:bg-secondary/80"
      >
        <Users className="size-3" />
        <span className="tabular-nums">{members.length}</span>
      </MetadataBadge>
    );

  return (
    <>
      <Popover modal>
        <PopoverTrigger render={trigger} />
        <PopoverContent align="end" className="w-64 p-1" finalFocus={false}>
          <div className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5">
            <span className="truncate text-sm font-semibold">{channel.title}</span>
            <Badge
              variant="secondary"
              className="min-w-5 px-1.5 text-2xs tabular-nums"
              aria-label={`${members.length} ${members.length === 1 ? "member" : "members"}`}
            >
              {members.length}
            </Badge>
          </div>
          <div className="my-1 h-px bg-border" />
          {artifacts.length > 0 && (
            <>
              <div
                role="list"
                aria-label={`Artifacts in #${channel.title}`}
                className="max-h-32 overflow-y-auto"
              >
                {artifacts.map((artifact) => (
                  <ChannelArtifactItem
                    key={workspaceFileId(artifact.file)}
                    artifact={artifact}
                    onSelect={() => toggleFile?.(artifact.file)}
                  />
                ))}
              </div>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          {memberAgents.length > 0 ? (
            <div role="list" aria-label={`Agents in #${channel.title}`}>
              {memberAgents.map(({ membership, agent }) => (
                <AgentMembershipItem
                  key={membership.sessionId}
                  membership={membership}
                  agent={agent}
                  action={
                    <div className="flex items-center">
                      <PopoverClose
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${agent.name}`}
                            title={`Edit ${agent.name}`}
                            onClick={() => setEditingAgentId(agent.id)}
                          />
                        }
                      >
                        <FilePenLine />
                      </PopoverClose>
                      <PopoverClose
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${agent.name} from #${channel.title}`}
                            title={`Remove ${agent.name}`}
                            onClick={() => setRemovingMember(membership)}
                          />
                        }
                      >
                        <X />
                      </PopoverClose>
                    </div>
                  }
                />
              ))}
            </div>
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Invite agents by @mentioning them.
            </p>
          )}
          <div className="my-1 h-px bg-border" />
          <PopoverClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              />
            }
          >
            <Trash2 /> Delete channel
          </PopoverClose>
        </PopoverContent>
      </Popover>

      {editingAgentId && (
        <AgentEditor agentId={editingAgentId} onClose={() => setEditingAgentId(undefined)} />
      )}
      {confirmingDelete && (
        <DeleteChannelDialog channel={channel} onOpenChange={setConfirmingDelete} />
      )}
      {removingMember && removingAgent && (
        <DestructiveConfirmationDialog
          key={removingMember.sessionId}
          title={`Remove ${removingAgent.name}?`}
          description={`This removes ${removingAgent.name} from #${channel.title} and deletes their private Channel session. Their Agent and experiences are preserved.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          mutation={channelMutations.removeMember(channel.id, removingMember.sessionId)}
          onOpenChange={(open) => {
            if (!open) setRemovingMember(undefined);
          }}
        />
      )}
    </>
  );
}

function ChannelArtifactItem({
  artifact,
  onSelect,
}: {
  artifact: ChannelArtifact;
  onSelect: () => void;
}) {
  const { file } = artifact;
  const { Icon } = useEditorDisplay(file);

  return (
    <PopoverClose
      render={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={file.path}
          className="w-full justify-start font-normal"
          onClick={onSelect}
        />
      }
    >
      <Icon />
      <ScrollableFade className="whitespace-nowrap text-left text-xs font-normal">
        <span className="shrink-0">{artifact.title}</span>
      </ScrollableFade>
    </PopoverClose>
  );
}

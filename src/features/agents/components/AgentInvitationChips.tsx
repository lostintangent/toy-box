import type { Agent } from "@agents/model";
import { AgentAvatar } from "./AgentAvatar";

export function AgentInvitationChips({ invitations }: { invitations: readonly Agent[] }) {
  if (invitations.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2 pb-1">
      {invitations.map((agent) => (
        <div
          key={agent.id}
          className="flex min-w-0 items-center gap-2 rounded-full border bg-muted/30 py-1 pl-1.5 pr-2 text-2xs"
        >
          <AgentAvatar name={agent.name} avatar={agent.avatar} className="size-5" />
          <span className="truncate">Invite {agent.name}</span>
        </div>
      ))}
    </div>
  );
}

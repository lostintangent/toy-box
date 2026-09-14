// One admission and wake path for an Agent in any host. Hosts prepare public
// context; Sessions owns execution, idle configuration, history, and worktrees.

import {
  agentHostId,
  type AgentHost,
  type AgentMembership,
  type AgentMention,
} from "@agents/model";
import type { SessionMessage, SessionSystemMessage } from "@sessions/model";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";
import {
  canCreateSessionWorktree,
  createSession,
  deliverSessionMessage,
  isSessionNotFoundError,
  type SessionContext,
} from "@sessions/server/runtime";
import { getAgentHostAdapter } from "@/server/agentHosts";
import { getStateDatabase } from "@/server/database";
import { sharedMap } from "@/shared/server/processState";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { broadcast } from "@workspace/server/events";
import { AgentDatabase } from "./database";

type MentionAgentInput = AgentMention & {
  host: AgentHost;
  message: SessionMessage | { systemMessage: SessionSystemMessage };
  directory?: string;
  initialContext?: SessionContext;
  hostLabel: string;
};

const admissionQueues = sharedMap<SerialTaskQueue>("agent-membership-admission-queues");

/** Ensure a durable membership, then steer its current work or start an idle Session. */
export async function mentionAgent(input: MentionAgentInput): Promise<void> {
  return withAdmission(input.host, input.agentId, async () => {
    const agents = new AgentDatabase(await getStateDatabase());
    const agent = await agents.getAgent(input.agentId);
    if (!agent) throw new Error("Agent not found.");
    const adapter = await getAgentHostAdapter(input.host);
    let membership = await agents.getMembership(input.host, input.agentId);
    if (membership) {
      try {
        const receipt = await deliverSessionMessage(membership.sessionId, input.message, {
          immediate: true,
        });
        if (receipt.disposition === "started") {
          await adapter.startTurn?.(agent, membership);
        }
        return;
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error;
        // An admitted membership may not yet have SDK history (for example,
        // after interrupted startup). Recreate it under the same durable ID.
        await assertAgentExecutionModeAvailable(membership.executionMode, input.directory);
      }
    } else {
      const executionMode = input.initialExecutionMode ?? "shared";
      await assertAgentExecutionModeAvailable(executionMode, input.directory);
      membership = {
        host: input.host,
        agentId: input.agentId,
        sessionId: `${SESSION_ID_PREFIX}${crypto.randomUUID()}`,
        executionMode,
      };
      if (adapter.admitAgent) {
        await adapter.admitAgent(agent, membership);
      } else {
        await agents.createMembership(membership);
      }
      announceAgentMembershipChange(membership.host);
    }

    await createSession(membership.sessionId, input.message, {
      directory: input.directory,
      initialContext: input.initialContext,
      sessionType: "agent",
      useWorktree: membership.executionMode === "worktree",
      name: `${agent.name} · ${input.hostLabel}`,
    });
    await adapter.startTurn?.(agent, membership);
  });
}

/** Validate isolated work before admitting a membership or recreating its Session. */
export async function assertAgentExecutionModeAvailable(
  executionMode: AgentMembership["executionMode"],
  directory?: string,
): Promise<void> {
  if (
    executionMode === "worktree" &&
    (!directory || !(await canCreateSessionWorktree(directory)))
  ) {
    throw new Error("This agent needs a Git working directory to use an isolated worktree.");
  }
}

export async function detachAgentSession(sessionId: string): Promise<void> {
  const database = await getStateDatabase({ createIfMissing: false });
  if (!database) return;
  const agents = new AgentDatabase(database);
  const membership = await agents.getMembershipBySession(sessionId);
  if (!membership) return;
  const adapter = await getAgentHostAdapter(membership.host);
  if (adapter.removeAgent) {
    const agent = await agents.getAgent(membership.agentId);
    if (!agent) throw new Error("Agent not found.");
    await adapter.removeAgent(agent, membership);
  } else if (!(await agents.deleteMembershipBySession(sessionId))) {
    return;
  }
  announceAgentMembershipChange(membership.host);
}

function announceAgentMembershipChange(host: AgentHost): void {
  broadcast({ type: "agent.membership.changed", host });
}

/** One lock per Agent/host identity, including the period before its Session exists. */
function withAdmission<Result>(
  host: AgentHost,
  agentId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const key = JSON.stringify([host.kind, agentHostId(host), agentId]);
  let queue = admissionQueues.get(key);
  if (!queue) {
    queue = new SerialTaskQueue();
    admissionQueues.set(key, queue);
  }
  return queue.enqueue(operation);
}

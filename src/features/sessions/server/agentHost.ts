// Ordinary Sessions own mention briefings and attributed public responses.

import {
  agentHandleFromName,
  findMentionedAgents,
  type Agent,
  type AgentMention,
} from "@agents/model";
import { getAgent, listAgents } from "@agents/server";
import type { AgentHostAdapter } from "@agents/server/host";
import { mentionAgent } from "@agents/server/supervisor";
import type { QueuedUserMessage } from "@sessions/model";
import { deliverSessionMessage, getSessionContext, getSessionSnapshot } from "./runtime";

export const SESSION_HOST_AGENT_INSTRUCTIONS = `Messages may @mention Agents, which Toy Box dispatches in parallel and renders with their own attribution. Do not answer for a mentioned Agent or emit a waiting acknowledgment. A mentioned Agent may complete silently. Contribute only distinct work or synthesis the user requested.`;

/** Resolve text at admission so a queued request keeps its recipients if an Agent is renamed. */
export async function resolveSessionAgentMentions(
  message: QueuedUserMessage,
): Promise<QueuedUserMessage> {
  if (message.agentMentions !== undefined || !message.content.includes("@")) return message;
  return {
    ...message,
    agentMentions: findMentionedAgents(message.content, await listAgents()).map(({ id }) => ({
      agentId: id,
    })),
  };
}

/** Queued messages only dispatch after the primary Session accepts them for execution. */
export async function dispatchSessionAgentMentions(
  hostSessionId: string,
  message: QueuedUserMessage,
): Promise<void> {
  if (!message.agentMentions?.length) return;
  const { resolveSessionType } = await import("@/server/managedSessions");
  const sessionType = await resolveSessionType(hostSessionId);
  if (sessionType !== "standard" && sessionType !== "hyper") return;
  const results = await Promise.allSettled(
    message.agentMentions.map((mention) => mentionAgentInSession(hostSessionId, message, mention)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length)
    throw new AggregateError(failures, "One or more persistent Agents could not be mentioned.");
}

async function mentionAgentInSession(
  hostSessionId: string,
  message: QueuedUserMessage,
  mention: AgentMention,
): Promise<void> {
  const agent = await getAgent(mention.agentId);
  if (!agent) throw new Error("Agent not found.");
  const [{ prompt, hostLabel }, context] = await Promise.all([
    buildSessionMentionContext(hostSessionId, agent, message.content),
    getSessionContext(hostSessionId),
  ]);
  await mentionAgent({
    host: { kind: "session", sessionId: hostSessionId },
    ...mention,
    message: { content: prompt, attachments: message.attachments },
    directory: context?.workingDirectory,
    initialContext: context,
    hostLabel,
  });
}

export const sessionAgentHost: AgentHostAdapter = {
  async getInstructions() {
    return `You are participating in an ordinary Toy Box Session.

Work independently using the visible briefing in the current prompt, your private transcript, and your experiences.

You may inspect Channels you belong to. When the user asks you to act in one, use continue_in_channel so that Channel membership performs the work in its own context.

Use send_session_response to publish a useful contribution with your own attribution and end your turn. Your final private reply is not published. If you have nothing useful to add, use finish_agent_turn.`;
  },
};

/** Publishing is a host operation, independent of private Session completion. */
export async function sendAgentResponse(sessionId: string, message: string): Promise<void> {
  const { resolveAgentMembership } = await import("@agents/server/runtime");
  const resolved = await resolveAgentMembership(sessionId);
  if (resolved?.membership.host.kind !== "session")
    throw new Error("This Agent does not belong to a Session host.");
  await deliverSessionMessage(
    resolved.membership.host.sessionId,
    {
      systemMessage: {
        type: "agent_response",
        name: resolved.agent.name,
        avatar: resolved.agent.avatar,
        executionMode: resolved.membership.executionMode,
        content: message,
      },
    },
    { immediate: true },
  );
}

async function buildSessionMentionContext(
  hostSessionId: string,
  agent: Agent,
  content: string,
): Promise<{ prompt: string; hostLabel: string }> {
  const snapshot = await getSessionSnapshot(hostSessionId);
  const lastMessage = snapshot.messages.at(-1);
  const priorMessages =
    lastMessage?.role === "user" && lastMessage.content === content
      ? snapshot.messages.slice(0, -1)
      : snapshot.messages;
  const transcript = priorMessages
    .flatMap((message) => {
      if (message.role === "user" || message.role === "assistant") {
        const visible = message.content.trim();
        return visible ? [`${message.role === "user" ? "User" : "Primary Agent"}: ${visible}`] : [];
      }
      if (message.content.type === "agent_response") {
        return [`${message.content.name}: ${message.content.content}`];
      }
      return [];
    })
    .join("\n\n")
    .slice(-12_000);
  const prompt = `The user mentioned you as @${agentHandleFromName(agent.name)} for an independent contribution.

Current request:
${content}

High-signal visible conversation context (private tool calls and reasoning are intentionally omitted):
${transcript || "No earlier visible messages."}`;
  const firstMessage = snapshot.messages[0];
  const hostLabel =
    firstMessage?.role === "user"
      ? firstMessage.content.trim().slice(0, 60) || "session"
      : "session";
  return { prompt, hostLabel };
}

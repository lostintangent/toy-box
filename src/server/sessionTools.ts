// Application composition for SDK session configuration. Features export
// model-facing instructions and tool definitions; handlers that call the
// Session runtime import it lazily to avoid an initialization cycle.

import type { Tool } from "@github/copilot-sdk";
import { AUTOMATION_SESSION_INSTRUCTIONS, automationTools } from "@automations/server/tools";
import { appLifecycleTools, artifactAppTools, createAppStateTools } from "@apps/server/tools";
import { editorTools, fileTools } from "@files/server/tools";
import { INBOX_SESSION_INSTRUCTIONS, inboxTools } from "@inbox/server/tools";
import { getWorkerAppId } from "@workers/server/database";
import { workerTools } from "@workers/server/tools";
import { createAgentTool, getAgentMembershipTools, listAgentsTool } from "@agents/server/tools";
import type { AgentHost } from "@agents/model";
import { channelAgentTools, channelTools, joinedChannelTools } from "@channels/server/tools";
import {
  coordinationTools,
  HYPER_SESSION_INSTRUCTIONS,
  hyperLifecycleTools,
  lifecycleTools,
  STANDARD_SESSION_INSTRUCTIONS,
  sessionLayoutTools,
  sessionTitleTools,
  sessionAgentTools,
} from "@sessions/server/tools";
import { SESSION_HISTORY_DISCOVERY_INSTRUCTIONS } from "@sessions/server/sdk/client";
import { settingsTools } from "@workspace/server/tools";
import type { SessionType } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { getAgentHostAdapter } from "./agentHosts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSessionTools(
  sessionType: SessionType,
  appId?: string,
  agentHost?: AgentHost["kind"],
): Tool<any>[] {
  const interactive = sessionType === "standard" || sessionType === "hyper";
  const privateAgent = sessionType === "agent";
  if (privateAgent && !agentHost) throw new Error("Agent tools require a host type.");
  const agentTools = privateAgent && agentHost ? getAgentMembershipTools(agentHost) : [];
  const canUpdateSettings = sessionType === "automation" || sessionType === "hyper";
  const canCreateAgents = interactive || sessionType === "inbox";
  const canUseChannels =
    sessionType === "standard" ||
    sessionType === "hyper" ||
    sessionType === "inbox" ||
    sessionType === "automation";
  return [
    ...(sessionType === "hyper" ? hyperLifecycleTools : []),
    ...(privateAgent ? [] : workerTools),
    ...(privateAgent ? [] : lifecycleTools),
    ...(sessionType === "standard" ? sessionTitleTools : []),
    ...(interactive ? sessionLayoutTools : []),
    ...(interactive ? fileTools : []),
    ...artifactAppTools,
    ...appLifecycleTools,
    ...(privateAgent ? [] : coordinationTools),
    ...automationTools,
    ...(canUseChannels ? [listAgentsTool, ...channelTools] : []),
    ...(canCreateAgents ? [createAgentTool] : []),
    ...createAppStateTools(sessionType === "worker" ? appId : undefined),
    ...(canUpdateSettings ? settingsTools : []),
    ...(sessionType === "hyper" ? editorTools : []),
    ...(sessionType === "inbox" ? inboxTools : []),
    ...(sessionType === "agent" && agentHost === "channel" ? channelAgentTools : []),
    ...(sessionType === "agent" && agentHost === "session"
      ? [...sessionAgentTools, ...joinedChannelTools]
      : []),
    ...agentTools,
  ];
}

/** Compose feature-owned tools, instructions, and configuration lifetime over the Session runtime. */
export async function getSessionConfiguration(sessionId: string, sessionType: SessionType) {
  const appId = sessionType === "worker" ? await getWorkerAppId(sessionId) : undefined;
  if (sessionType !== "agent")
    return {
      configurationKey: undefined,
      tools: getSessionTools(sessionType, appId),
      additionalInstructions: await getSessionInstructions(sessionType),
    };

  const runtime = await import("@agents/server/runtime");
  const resolved = await runtime.resolveAgentMembership(sessionId);
  if (!resolved) {
    throw new Error("Agent sessions require a persistent Agent membership.");
  }
  const { agent, membership } = resolved;
  const kind = membership.host.kind;
  const host = await getAgentHostAdapter(membership.host);
  const hostInstructions = await host.getInstructions(agent, membership);
  const model = agent.model ?? (await getWorkspaceDefaultModel());
  const additionalInstructions = runtime.buildAgentSystemInstructions(agent, hostInstructions);
  return {
    tools: getSessionTools(sessionType, appId, kind),
    additionalInstructions,
    configurationKey: JSON.stringify([kind, model, additionalInstructions]),
    disableMemory: true as const,
    ...(model ? { model } : {}),
  };
}

async function getSessionInstructions(sessionType: Exclude<SessionType, "agent">) {
  const parts: string[] = [];
  if (sessionType === "standard" || sessionType === "hyper") {
    parts.push(
      sessionType === "standard" ? STANDARD_SESSION_INSTRUCTIONS : HYPER_SESSION_INSTRUCTIONS,
      (await import("@sessions/server/agentHost")).SESSION_HOST_AGENT_INSTRUCTIONS,
    );
  } else if (sessionType === "automation") {
    parts.push(AUTOMATION_SESSION_INSTRUCTIONS);
  } else if (sessionType === "inbox") {
    parts.push(INBOX_SESSION_INSTRUCTIONS);
  }
  parts.push(SESSION_HISTORY_DISCOVERY_INSTRUCTIONS);
  return parts.join("\n\n");
}

/** Resolve the same implicit default the model picker presents. Passing it
 * explicitly lets a resumed Agent leave behind an earlier durable override. */
async function getWorkspaceDefaultModel(): Promise<ModelConfiguration | undefined> {
  const settings = await (await import("@workspace/server/state/settings")).getSettings();
  if (settings.defaultModel) return settings.defaultModel;

  const models = await (await import("@sessions/server/sdk/client")).listModels();
  return models[0] ? { name: models[0].id } : undefined;
}

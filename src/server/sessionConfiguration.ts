// Application composition for SDK session configuration. Features own their
// model-facing instructions and tools. This module declares which ones each
// Session type receives and resolves private Channel Agent configuration.

import { buildAgentSystemInstructions, resolveAgentMembership } from "@agents/server/runtime";
import { agentSelfTools, createAgentTool, listAgentsTool } from "@agents/server/tools";
import { appLifecycleTools, artifactAppTools, createAppStateTools } from "@apps/server/tools";
import { AUTOMATION_SESSION_INSTRUCTIONS, automationTools } from "@automations/server/tools";
import { channelTools } from "@channels/server/tools";
import { editorTools, fileTools } from "@files/server/tools";
import { INBOX_SESSION_INSTRUCTIONS, inboxTools } from "@inbox/server/tools";
import { listModels } from "@providers/server";
import type { SessionType } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { SESSION_HISTORY_DISCOVERY_INSTRUCTIONS } from "@sessions/server/instructions";
import { readProviderBinding } from "@sessions/server/state/sessions";
import {
  coordinationTools,
  HYPER_SESSION_INSTRUCTIONS,
  hyperLifecycleTools,
  lifecycleTools,
  sessionHistoryTools,
  sessionLayoutTools,
  sessionTitleTools,
  STANDARD_SESSION_INSTRUCTIONS,
} from "@sessions/server/tools";
import type { Tool } from "@sessions/server/tools/definition";
import { getWorkerAppId } from "@workers/server/database";
import { workerTools } from "@workers/server/tools";
import { getSettings } from "@workspace/server/state/settings";
import { settingsTools } from "@workspace/server/tools";
import { getAgentHostAdapter } from "./agentHosts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionTool = Tool<any>;
type NonAgentSessionType = Exclude<SessionType, "agent">;

type SessionTypePolicy = {
  instructions: readonly string[];
  hyperLifecycle?: true;
  title?: true;
  layout?: true;
  files?: true;
  channels?: true;
  createAgents?: true;
  settings?: true;
  editor?: true;
  inbox?: true;
};

// Channel Agent sessions delegate to their host adapter below.
const sessionTypePolicies: Record<NonAgentSessionType, SessionTypePolicy> = {
  standard: {
    instructions: [STANDARD_SESSION_INSTRUCTIONS, SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
    title: true,
    layout: true,
    files: true,
    channels: true,
    createAgents: true,
  },
  hyper: {
    instructions: [HYPER_SESSION_INSTRUCTIONS, SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
    hyperLifecycle: true,
    layout: true,
    files: true,
    channels: true,
    createAgents: true,
    settings: true,
    editor: true,
  },
  automation: {
    instructions: [AUTOMATION_SESSION_INSTRUCTIONS, SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
    channels: true,
    settings: true,
  },
  inbox: {
    instructions: [INBOX_SESSION_INSTRUCTIONS, SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
    channels: true,
    createAgents: true,
    inbox: true,
  },
  worker: {
    instructions: [SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
  },
};

/** Compose feature-owned tools, instructions, and configuration lifetime over the Session runtime. */
export async function getSessionConfiguration(sessionId: string, sessionType: SessionType) {
  if (sessionType === "agent") return getPrivateAgentConfiguration(sessionId);

  const policy = sessionTypePolicies[sessionType];
  const appId = sessionType === "worker" ? await getWorkerAppId(sessionId) : undefined;
  return {
    configurationKey: undefined,
    tools: getNonAgentSessionTools(policy, { appId }),
    additionalInstructions: policy.instructions.join("\n\n"),
  };
}

async function getPrivateAgentConfiguration(sessionId: string) {
  const resolved = await resolveAgentMembership(sessionId);
  if (!resolved) throw new Error("Agent sessions require a persistent Agent membership.");

  const { agent, membership } = resolved;
  const host = await getAgentHostAdapter();
  const hostInstructions = await host.getInstructions(agent, membership);
  const model = agent.model ?? (await getWorkspaceDefaultModel(sessionId));
  const additionalInstructions = buildAgentSystemInstructions(agent, hostInstructions);
  return {
    tools: getPrivateAgentTools(host.getTools?.() ?? []),
    additionalInstructions,
    configurationKey: JSON.stringify([model, additionalInstructions]),
    disableMemory: true as const,
    ...(model ? { model } : {}),
  };
}

function getNonAgentSessionTools(
  policy: SessionTypePolicy,
  { appId }: { appId?: string } = {},
): SessionTool[] {
  return [
    ...sessionHistoryTools,
    ...(policy.hyperLifecycle ? hyperLifecycleTools : []),
    ...workerTools,
    ...lifecycleTools,
    ...(policy.title ? sessionTitleTools : []),
    ...(policy.layout ? sessionLayoutTools : []),
    ...(policy.files ? fileTools : []),
    ...artifactAppTools,
    ...appLifecycleTools,
    ...coordinationTools,
    ...automationTools,
    ...(policy.channels ? [listAgentsTool, ...channelTools] : []),
    ...(policy.createAgents ? [createAgentTool] : []),
    ...createAppStateTools(appId),
    ...(policy.settings ? settingsTools : []),
    ...(policy.editor ? editorTools : []),
    ...(policy.inbox ? inboxTools : []),
  ];
}

function getPrivateAgentTools(hostTools: SessionTool[]): SessionTool[] {
  return [
    ...artifactAppTools,
    ...appLifecycleTools,
    ...automationTools,
    ...createAppStateTools(),
    ...hostTools,
    ...agentSelfTools,
  ];
}

/** Inherit workspace defaults within an existing session's provider. A new
 * default provider applies to new sessions; existing conversations retain theirs. */
async function getWorkspaceDefaultModel(
  sessionId: string,
): Promise<ModelConfiguration | undefined> {
  const binding = await readProviderBinding(sessionId);
  const settings = await getSettings();
  if (settings.defaultModel)
    return !binding || settings.defaultModel.provider === binding.providerId
      ? settings.defaultModel
      : undefined;

  const models = await listModels();
  const model = models.find((candidate) => !binding || candidate.provider === binding.providerId);
  return model ? { name: model.id, provider: model.provider } : undefined;
}

// Application composition for SDK session configuration. Features own their
// model-facing instructions and tools. This module declares which ones each
// Session type receives and resolves owner-specific Worker configuration.

import { appLifecycleTools, artifactAppTools, createAppStateTools } from "@apps/server/tools";
import { AUTOMATION_SESSION_INSTRUCTIONS, automationTools } from "@automations/server/tools";
import { channelTools, createChannelMembersTool } from "@channels/server/tools";
import { editorTools, fileTools } from "@files/server/tools";
import { INBOX_SESSION_INSTRUCTIONS, inboxTools } from "@inbox/server/tools";
import type { SessionType } from "@sessions/model";
import { SESSION_HISTORY_DISCOVERY_INSTRUCTIONS } from "@sessions/server/instructions";
import {
  coordinationTools,
  HYPER_SESSION_INSTRUCTIONS,
  hyperLifecycleTools,
  lifecycleTools,
  modelTools,
  sessionHistoryTools,
  sessionLayoutTools,
  sessionTitleTools,
  STANDARD_SESSION_INSTRUCTIONS,
} from "@sessions/server/tools";
import type { Tool } from "@sessions/server/tools/definition";
import { getPersistedWorker } from "@workers/server/database";
import { workerTools } from "@workers/server/tools";
import { settingsTools } from "@workspace/server/tools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionTool = Tool<any>;
type SessionTypePolicy = {
  instructions: readonly string[];
  hyperLifecycle?: true;
  title?: true;
  layout?: true;
  files?: true;
  channels?: true;
  staffChannels?: true;
  settings?: true;
  editor?: true;
  inbox?: true;
};

const sessionTypePolicies: Record<SessionType, SessionTypePolicy> = {
  standard: {
    instructions: [STANDARD_SESSION_INSTRUCTIONS, SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
    title: true,
    layout: true,
    files: true,
    channels: true,
    staffChannels: true,
  },
  hyper: {
    instructions: [HYPER_SESSION_INSTRUCTIONS, SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
    hyperLifecycle: true,
    layout: true,
    files: true,
    channels: true,
    staffChannels: true,
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
    staffChannels: true,
    inbox: true,
  },
  worker: {
    instructions: [SESSION_HISTORY_DISCOVERY_INSTRUCTIONS],
  },
};

/** Compose feature-owned tools, instructions, and configuration lifetime over the Session runtime. */
export async function getSessionConfiguration(sessionId: string, sessionType: SessionType) {
  const worker = sessionType === "worker" ? await getPersistedWorker(sessionId) : undefined;
  if (sessionType === "worker") {
    if (!worker) throw new Error("Worker sessions require persisted ownership.");
    if (worker.type === "channel") {
      const { getChannelAgentConfiguration } = await import("@channels/server/agent");
      return getChannelAgentConfiguration(worker);
    }
  }

  const policy = sessionTypePolicies[sessionType];
  const appId = worker?.type === "app" ? worker.appId : undefined;
  return {
    configurationKey: undefined,
    tools: getSessionTools(policy, { appId }),
    additionalInstructions: policy.instructions.join("\n\n"),
  };
}

function getSessionTools(
  policy: SessionTypePolicy,
  { appId }: { appId?: string } = {},
): SessionTool[] {
  return [
    ...sessionHistoryTools,
    ...modelTools,
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
    ...(policy.channels ? channelTools : []),
    ...(policy.staffChannels ? [createChannelMembersTool] : []),
    ...createAppStateTools(appId),
    ...(policy.settings ? settingsTools : []),
    ...(policy.editor ? editorTools : []),
    ...(policy.inbox ? inboxTools : []),
  ];
}

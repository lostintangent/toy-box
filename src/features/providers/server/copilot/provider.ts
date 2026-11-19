import { approveAll } from "@microsoft/copilot-sdk";
import type {
  CopilotSession,
  CopilotClient,
  CreateSessionOptions,
  SessionMetadata,
  Tool as CopilotTool,
  ToolResultObject,
} from "@microsoft/copilot-sdk";
import type { SessionEvent } from "@sessions/model";
import type { ProviderSubscription } from "@providers/model";
import {
  toolInputSchema,
  type NativeSession,
  type SessionConfiguration,
  type SessionProvider,
} from "@providers/server/provider";
import { startCopilotClient, stopCopilotClient } from "./client";
import { connectCopilotSession, holdNativeEvents, toSdkSetModelOptions } from "./connection";
import { toModelInfo } from "./models";
import { toSessionSkills } from "./skills";
import { createSdkEventProjector } from "./projector";

export const copilotProvider: SessionProvider = {
  id: "copilot",
  name: "GitHub Copilot",
  async isSignedIn() {
    return (await (await startCopilotClient()).getAuthStatus()).isAuthenticated;
  },
  async listModels() {
    return (await (await startCopilotClient()).listModels()).map(toModelInfo);
  },
  async readSubscription() {
    const { rpc } = await startCopilotClient();
    const { authInfo } = await rpc.account.getCurrentAuth();
    const plan =
      authInfo && "copilotUser" in authInfo ? authInfo.copilotUser?.copilot_plan : undefined;
    return plan ? toSubscription(plan, (await rpc.account.getQuota({})).quotaSnapshots) : undefined;
  },
  async listSessions(limit) {
    const client = await startCopilotClient();
    if (limit === undefined) return (await client.listSessions()).map(toSession);
    const entries = (await client.rpc.sessions.list({ metadataLimit: 0 })).sessions.filter(
      (entry) => !entry.isRemote,
    );
    // Enrichment drops empty sessions, but its start times differ from `readSession`'s, so
    // metadata supplies the fields.
    const sessions: NativeSession[] = [];
    let start = 0;
    while (start < entries.length && sessions.length < limit) {
      const end = start + limit - sessions.length;
      const batch = entries.slice(start, end);
      const [enriched, metadata] = await Promise.all([
        client.rpc.sessions.enrichMetadata({ sessions: batch }),
        Promise.all(batch.map(({ sessionId }) => client.getSessionMetadata(sessionId))),
      ]);
      const listed = new Set(enriched.sessions.map(({ sessionId }) => sessionId));
      for (const session of metadata) {
        if (session && listed.has(session.sessionId)) sessions.push(toSession(session));
      }
      start = end;
    }
    return sessions;
  },
  async readSession(nativeId) {
    const metadata = await (await startCopilotClient()).getSessionMetadata(nativeId);
    return metadata && toSession(metadata);
  },
  async readHistory(nativeId) {
    const client = await startCopilotClient();
    const project = createSdkEventProjector();
    const events: SessionEvent[] = [];
    let cursor: string | undefined;
    let hasMore: boolean;
    do {
      const page = await client.rpc.sessions.readPersistedEvents({
        sessionId: nativeId,
        direction: "forward",
        max: 1000,
        cursor,
      });
      events.push(...page.events.flatMap(project));
      cursor = page.cursor;
      hasMore = page.hasMore;
    } while (hasMore);
    return events;
  },
  async listSkills(cwd, skillDirectories) {
    const { skills } = await (
      await startCopilotClient()
    ).rpc.skills.discover({
      ...(cwd ? { projectPaths: [cwd] } : {}),
      skillDirectories: [...skillDirectories],
    });
    return toSessionSkills(skills);
  },
  async create(sessionId, configuration) {
    const client = await startCopilotClient();
    const early = holdNativeEvents();
    const session = await client.createSession({
      ...nativeConfiguration(configuration, early),
      sessionId,
      name: configuration.name || undefined,
    });
    try {
      return await connect(session, configuration.allowUserQuestions, early);
    } catch (error) {
      await client.deleteSession(session.sessionId).catch(console.error);
      throw error;
    }
  },
  async resume(nativeId, configuration) {
    const client = await startCopilotClient();
    const early = holdNativeEvents();
    const native = await client.resumeSession(nativeId, nativeConfiguration(configuration, early));
    const connection = await connect(native, configuration.allowUserQuestions, early);
    const { model } = configuration;
    // Workaround (Copilot CLI 1.0.114; listed in providers/AGENTS.md): resume keeps the session's
    // last effort when the configuration names none, even one the resumed model rejects. Remove
    // once resume clears it.
    if (model && !model.reasoningEffort && (await native.rpc.model.getCurrent()).reasoningEffort)
      await connection.setModel(model);
    return connection;
  },
  async isHistoryCurrent(nativeId, capturedAt) {
    const metadata = await (await startCopilotClient()).getSessionMetadata(nativeId);
    // Preserve the SDK's short trailing-flush window after a completed turn.
    return !!metadata && metadata.modifiedTime.getTime() <= capturedAt + 2_000;
  },
  async delete(nativeId) {
    await (await startCopilotClient()).deleteSession(nativeId).catch((error: Error) => {
      // Workaround (Copilot CLI 1.0.114; listed in providers/AGENTS.md): a missing history is
      // reported only in the error's message. Remove once the CLI reports it with a code.
      if (!error.message.endsWith(`Session file not found for ${nativeId}`)) throw error;
    });
  },
  stop: stopCopilotClient,
};

type CopilotQuotas = Awaited<
  ReturnType<CopilotClient["rpc"]["account"]["getQuota"]>
>["quotaSnapshots"];

/** Copilot meters premium requests monthly, unless the plan makes them unlimited. */
export function toSubscription(plan: string, quotas: CopilotQuotas): ProviderSubscription {
  const premium = quotas.premium_interactions;
  return {
    plan,
    limits:
      premium && !premium.isUnlimitedEntitlement
        ? [
            {
              name: "Premium requests",
              usedPercent: 100 - premium.remainingPercentage,
              ...(premium.resetDate ? { resetsAt: Date.parse(premium.resetDate) } : {}),
            },
          ]
        : [],
  };
}

async function connect(
  session: CopilotSession,
  allowUserQuestions: boolean,
  early: ReturnType<typeof holdNativeEvents>,
) {
  if (allowUserQuestions)
    await session.rpc.eventLog.registerInterest({ eventType: "user_input.requested" });
  return connectCopilotSession(session, early);
}

function nativeConfiguration(
  configuration: SessionConfiguration,
  early: ReturnType<typeof holdNativeEvents>,
): CreateSessionOptions {
  const tools: CopilotTool<any>[] = configuration.tools.map((tool) => ({
    ...tool,
    parameters: toolInputSchema(tool.parameters),
    // The CLI hides a thrown error's message from the model; a failure result carries it.
    handler: (args: unknown) =>
      tool.handler(args).catch((error): ToolResultObject => ({
        textResultForLlm: error instanceof Error ? error.message : String(error),
        resultType: "failure",
      })),
    skipPermission: true,
    defer: tool.alwaysLoad ? "never" : "auto",
  }));
  return {
    model: configuration.model?.name,
    inference: toSdkSetModelOptions(configuration.model),
    workingDirectory: configuration.directory,
    enableConfigDiscovery: true,
    systemMessage: { mode: "append", content: configuration.instructions },
    events: { streaming: true, onEvent: early.onEvent },
    canvases: { requestRenderer: true },
    skills: { enabled: true, directories: configuration.skillDirectories },
    tools: { definitions: tools, imageGeneration: { enabled: true } },
    // Toy Box approves every request; allow-all also keeps the CLI from journaling each one.
    permissions: { mode: "allow-all", onRequest: approveAll },
    ...(configuration.disableMemory ? { state: { memory: { enabled: false } } } : {}),
  };
}

function toSession({ sessionId, startTime, modifiedTime, summary, context }: SessionMetadata) {
  return {
    nativeId: sessionId,
    createdAt: startTime,
    updatedAt: modifiedTime,
    title: summary,
    context: {
      directory: context?.workingDirectory,
      gitRoot: context?.gitRoot,
      repository: context?.repository,
      branch: context?.branch,
    },
  };
}

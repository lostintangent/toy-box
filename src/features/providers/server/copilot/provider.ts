import { homedir } from "node:os";
import { approveAll } from "@github/copilot-sdk";
import type {
  CopilotSession,
  CopilotClient,
  SessionConfig,
  SessionContext,
  Tool as CopilotTool,
} from "@github/copilot-sdk";
import type { SessionEvent } from "@sessions/model";
import type { ProviderSubscription } from "@providers/model";
import {
  SessionNotFoundError,
  type SessionConfiguration,
  type SessionProvider,
} from "@providers/server/provider";
import { normalizeToolResult } from "@sessions/server/tools/definition";
import { startCopilotClient, stopCopilotClient } from "./client";
import { connectCopilotSession } from "./connection";
import { toModelInfo } from "./models";
import { toSdkSetModelOptions } from "./modelConfiguration";
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
  async listSessions() {
    return (await (await startCopilotClient()).listSessions()).map(
      ({ sessionId, startTime, modifiedTime, summary, context }) => ({
        id: sessionId,
        createdAt: startTime,
        updatedAt: modifiedTime,
        title: summary,
        context: {
          directory: sessionDirectory(context),
          gitRoot: context?.gitRoot,
          repository: context?.repository,
          branch: context?.branch,
        },
      }),
    );
  },
  async readHistory({ id, provider }) {
    const nativeId = provider?.sessionId ?? id;
    const client = await startCopilotClient();
    const project = createSdkEventProjector(id);
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
    const session = await client.createSession({
      ...nativeConfiguration(sessionId, configuration),
      sessionId,
      name: configuration.name || undefined,
    });
    try {
      return await connect(
        session,
        sessionId,
        configuration.allowUserQuestions,
        configuration.model,
      );
    } catch (error) {
      await client.deleteSession(session.sessionId).catch(console.error);
      throw error;
    }
  },
  async resume(session, configuration) {
    const client = await startCopilotClient();
    const native = await client.resumeSession(
      session.provider?.sessionId ?? session.id,
      nativeConfiguration(session.id, configuration),
    );
    return connect(native, session.id, configuration.allowUserQuestions, configuration.model);
  },
  async readDirectory(nativeId) {
    return sessionDirectory(
      (await (await startCopilotClient()).getSessionMetadata(nativeId))?.context,
    );
  },
  async isHistoryCurrent(nativeId, capturedAt) {
    const metadata = await (await startCopilotClient()).getSessionMetadata(nativeId);
    // Preserve the SDK's short trailing-flush window after a completed turn.
    return !!metadata && metadata.modifiedTime.getTime() <= capturedAt + 2_000;
  },
  async delete(nativeId) {
    const client = await startCopilotClient();
    if (!(await client.getSessionMetadata(nativeId))) throw new SessionNotFoundError(nativeId);
    await client.deleteSession(nativeId);
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
  sessionId: string,
  allowUserQuestions: boolean,
  appliedModel?: SessionConfiguration["model"],
) {
  // Toy Box approves every request; allow-all also keeps the CLI from journaling each one.
  await session.rpc.permissions.setMode({ mode: "allow-all" });
  if (allowUserQuestions)
    await session.rpc.eventLog.registerInterest({ eventType: "user_input.requested" });
  return connectCopilotSession(session, sessionId, appliedModel);
}

function nativeConfiguration(
  sessionId: string,
  configuration: SessionConfiguration,
): SessionConfig {
  const tools: CopilotTool<any>[] = configuration.tools.map((tool) => ({
    ...tool,
    skipPermission: true,
    defer: tool.alwaysLoad ? "never" : "auto",
    handler: async (args) => {
      const result = normalizeToolResult(
        await tool.handler(tool.parameters ? tool.parameters.parse(args) : args, sessionId),
      );
      return {
        textResultForLlm: result.content
          .flatMap((item) => (item.type === "text" ? [item.text] : []))
          .join("\n"),
        binaryResultsForLlm: result.content.flatMap((item) =>
          item.type === "image" ? [{ ...item, type: "image" as const }] : [],
        ),
        resultType: result.isError ? ("failure" as const) : ("success" as const),
      };
    },
  }));
  return {
    streaming: true,
    requestCanvasRenderer: true,
    model: configuration.model?.name,
    ...toSdkSetModelOptions(configuration.model),
    workingDirectory: configuration.directory,
    enableConfigDiscovery: true,
    imageGeneration: { enabled: true },
    enableSkills: true,
    skillDirectories: configuration.skillDirectories,
    systemMessage: { mode: "append", content: configuration.instructions },
    onPermissionRequest: approveAll,
    tools,
    ...(configuration.disableMemory ? { memory: { enabled: false } } : {}),
  };
}

/** The SDK's implicit home directory is not a user-selected workspace. */
function sessionDirectory(context?: SessionContext): string | undefined {
  if (!context?.workingDirectory) return undefined;
  return context.workingDirectory === homedir() && !context.gitRoot && !context.repository
    ? undefined
    : context.workingDirectory;
}

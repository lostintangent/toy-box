import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { approveAll } from "@github/copilot-sdk";
import type {
  CopilotSession,
  SessionConfig,
  SessionContext,
  Tool as CopilotTool,
} from "@github/copilot-sdk";
import type { SessionEvent } from "@sessions/model";
import type { SessionConfiguration, SessionProvider } from "@providers/server/provider";
import { normalizeToolResult } from "@sessions/server/tools/definition";
import { SESSION_STATE_PATH } from "./constants";
import { startCopilotClient, stopCopilotClient } from "./client";
import { connectCopilotSession } from "./connection";
import { adaptModelCatalog } from "./models";
import { toSdkSessionModelOptions, toSdkSetModelOptions } from "./modelConfiguration";
import { toSessionSkills } from "./skills";
import { createSdkEventProjector } from "./projector";

export const copilotProvider: SessionProvider = {
  id: "copilot",
  name: "GitHub Copilot",
  isInstalled: () => !!Bun.which("copilot"),
  async listModels() {
    return adaptModelCatalog(await (await startCopilotClient()).listModels()).map(
      ({ id, name, supportedReasoningEfforts, defaultReasoningEffort, supportedContextTiers }) => ({
        id,
        name,
        provider: "copilot",
        supportedReasoningEfforts,
        defaultReasoningEffort,
        supportedContextTiers,
      }),
    );
  },
  async listSessions() {
    return (await (await startCopilotClient()).listSessions()).map(
      ({ sessionId, startTime, modifiedTime, summary, context }) => ({
        sessionId,
        startTime,
        modifiedTime,
        title: summary,
        directory: sessionDirectory(context),
        gitRoot: context?.gitRoot,
        repository: context?.repository,
        branch: context?.branch,
      }),
    );
  },
  async readHistory({ sessionId, nativeId }) {
    const client = await startCopilotClient();
    const project = createSdkEventProjector(sessionId);
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
      sessionId,
      ...nativeConfiguration(sessionId, configuration),
    });
    try {
      // TODO: Remove once SDK creation initializes Git context from workingDirectory.
      await session.rpc.metadata.setWorkingDirectory({
        workingDirectory: configuration.directory,
      });
      return await connect(session, sessionId, configuration.allowUserQuestions);
    } catch (error) {
      await client.deleteSession(session.sessionId).catch(console.error);
      throw error;
    }
  },
  async resume(identity, configuration) {
    const session = await (
      await startCopilotClient()
    ).resumeSession(identity.nativeId, nativeConfiguration(identity.sessionId, configuration));
    // The SDK restores the persisted model on resume despite a supplied override.
    if (configuration.model)
      await session.setModel(configuration.model.name, toSdkSetModelOptions(configuration.model));
    return connect(session, identity.sessionId, configuration.allowUserQuestions);
  },
  async readDirectory(nativeId) {
    return sessionDirectory(
      (await (await startCopilotClient()).getSessionMetadata(nativeId))?.context,
    );
  },
  async isHistoryCurrent(nativeId, capturedAt) {
    try {
      // Preserve the SDK's short trailing-flush window after a completed turn.
      return (
        (await stat(join(homedir(), SESSION_STATE_PATH, nativeId, "events.jsonl"))).mtimeMs <=
        capturedAt + 2_000
      );
    } catch {
      return false;
    }
  },
  async delete(nativeId) {
    await (await startCopilotClient()).deleteSession(nativeId);
  },
  stop: stopCopilotClient,
};

async function connect(session: CopilotSession, sessionId: string, allowUserQuestions: boolean) {
  if (allowUserQuestions)
    await session.rpc.eventLog.registerInterest({ eventType: "user_input.requested" });
  return connectCopilotSession(session, sessionId);
}

function nativeConfiguration(
  sessionId: string,
  configuration: SessionConfiguration,
): SessionConfig {
  const tools: CopilotTool<any>[] = configuration.tools.map((tool) => ({
    ...tool,
    skipPermission: true,
    handler: async (args, invocation) => {
      const result = normalizeToolResult(
        await tool.handler(tool.parameters ? tool.parameters.parse(args) : args, {
          ...invocation,
          sessionId,
        }),
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
    ...toSdkSessionModelOptions(configuration.model),
    workingDirectory: configuration.directory,
    enableConfigDiscovery: true,
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

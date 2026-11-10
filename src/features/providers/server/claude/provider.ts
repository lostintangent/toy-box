import { deleteSession, getSessionInfo, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  Query,
  SDKControlGetUsageResponse,
  SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import type { ProviderSubscription } from "@providers/model";
import type { SessionProvider } from "@providers/server/provider";
import { ClaudeConnection } from "./connection";
import { claudeSkillPlugins, closeClaudeQuery, startClaudeQuery, stopClaude } from "./client";
import { readClaudeHistory, readTranscriptDirectory } from "./history";
import { createClaudeProjector } from "./projector";
import { toModelInfo } from "./models";

export const claudeProvider: SessionProvider = {
  id: "claude",
  name: "Claude Agent",
  async isSignedIn() {
    // The SDK's accountInfo only implies sign-in; the CLI reports it directly.
    const status = await Bun.$`claude auth status`.cwd(homedir()).nothrow().quiet().json();
    return status.loggedIn === true;
  },
  async listModels() {
    return probeClaude(async (native) =>
      (await native.supportedModels())
        .filter((model) => model.value !== "default")
        .map(toModelInfo),
    );
  },
  async readSubscription() {
    return toSubscription(
      await probeClaude((native) =>
        native.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      ),
    );
  },
  async listSkills(directory, skillDirectories) {
    return probeClaude(
      async (native) =>
        (await native.reloadSkills()).skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          type: "global" as const,
        })),
      {
        cwd: directory ?? homedir(),
        skills: "all",
        plugins: claudeSkillPlugins(directory, skillDirectories),
      },
    );
  },
  async listSessions() {
    return (await listSessions()).map(toSession);
  },
  async readSession(nativeId) {
    const info = await getSessionInfo(nativeId);
    return (
      info && toSession({ ...info, cwd: info.cwd ?? (await readTranscriptDirectory(nativeId)) })
    );
  },
  async readHistory(nativeId) {
    return (await readClaudeHistory(nativeId)).flatMap(createClaudeProjector());
  },
  create: (sessionId, configuration) => ClaudeConnection.open(sessionId, configuration),
  async resume(nativeId, configuration) {
    // Workaround (Claude CLI 2.1.302; listed in providers/AGENTS.md): resume never restores
    // reasoning effort and restores the model only when the CLI recognizes it. Reopen with the
    // last reply's model and effort from history; remove once the CLI restores both itself.
    const model =
      configuration.model ??
      (await claudeProvider.readHistory(nativeId))
        .flatMap((event) =>
          event.type === "model_changed" && !event.parentToolCallId ? [event.model] : [],
        )
        .at(-1);
    return ClaudeConnection.open(nativeId, { ...configuration, model }, true);
  },
  async isHistoryCurrent(nativeId, capturedAt) {
    const info = await getSessionInfo(nativeId);
    return info !== undefined && info.lastModified < capturedAt;
  },
  async delete(nativeId) {
    await deleteSession(nativeId).catch((error: Error) => {
      // Workaround (Claude Agent SDK 0.3.319; listed in providers/AGENTS.md): a missing history
      // is reported only in the error's message. Remove once the SDK reports it with a code.
      if (error.message !== `Session ${nativeId} not found in any project directory`) throw error;
    });
  },
  stop: stopClaude,
};

/** Read from a throwaway Claude query, closing it once the read settles. */
async function probeClaude<T>(read: (native: Query) => Promise<T>, options: Options = {}) {
  const native = startClaudeQuery({ persistSession: false, cwd: homedir(), ...options });
  try {
    return await read(native);
  } finally {
    await closeClaudeQuery(native);
  }
}

function toSession(session: SDKSessionInfo) {
  return {
    nativeId: session.sessionId,
    title: session.summary,
    createdAt: new Date(session.createdAt ?? session.lastModified),
    updatedAt: new Date(session.lastModified),
    context: {
      directory: session.cwd,
      branch: session.gitBranch === "HEAD" ? undefined : session.gitBranch,
    },
  };
}

/**
 * Claude plans meter a 5-hour window and weekly windows, some per model. A window
 * without a reset time isn't metered for this plan, so it's omitted.
 */
export function toSubscription({
  subscription_type: plan,
  rate_limits: windows,
}: SDKControlGetUsageResponse): ProviderSubscription | undefined {
  if (!plan) return undefined;
  const limit = (
    name: string,
    window: { utilization: number | null; resets_at: string | null } | null | undefined,
  ) =>
    window?.utilization == null || !window.resets_at
      ? []
      : [{ name, usedPercent: window.utilization, resetsAt: Date.parse(window.resets_at) }];
  return {
    plan,
    limits: [
      ...limit("5-hour", windows?.five_hour),
      ...limit("Weekly", windows?.seven_day),
      ...limit("Weekly Opus", windows?.seven_day_opus),
      ...limit("Weekly Sonnet", windows?.seven_day_sonnet),
      // Newer per-model weekly windows name their own models.
      ...(windows?.model_scoped ?? []).flatMap((window) =>
        limit(`Weekly ${window.display_name}`, window),
      ),
    ],
  };
}

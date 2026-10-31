import type { JsonValue, ModelListResponse, ThreadListResponse } from "./protocol";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionConfiguration, SessionProvider } from "@providers/server/provider";
import type { ProviderSubscription } from "@providers/model";
import type { SessionSkill } from "@sessions/model";
import { startCodexClient, stopCodexClient } from "./protocol/transport";
import { CodexConnection } from "./connection";
import { readThreadHistory } from "./history";
import {
  codexHistoryEvents,
  codexModel,
  createCodexProjector,
  subagentThreadId,
} from "./projector";
import type {
  GetAccountRateLimitsResponse,
  Model,
  RateLimitSnapshot,
  Thread,
  ThreadStartParams,
} from "./protocol";

export const codexProvider: SessionProvider = {
  id: "codex",
  name: "OpenAI Codex",
  async isSignedIn() {
    const rpc = await startCodexClient();
    const { account, requiresOpenaiAuth } = await rpc.request("account/read", {});
    return !!account || !requiresOpenaiAuth;
  },
  async listModels() {
    const rpc = await startCodexClient();
    const models: Model[] = [];
    let cursor: string | null = null;
    do {
      const page: ModelListResponse = await rpc.request("model/list", { cursor, limit: 100 });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return models
      .filter((model) => !model.hidden)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((model) => ({
        id: model.model,
        name: model.displayName,
        provider: "codex",
        supportedReasoningEfforts: model.supportedReasoningEfforts.map(
          (effort) => effort.reasoningEffort,
        ),
        defaultReasoningEffort: model.defaultReasoningEffort,
      }));
  },
  async readSubscription() {
    const rpc = await startCodexClient();
    return toSubscription(
      await rpc.request("account/rateLimits/read", { excludeResetCreditDetails: true }),
    );
  },
  listSkills,
  async readHistory({ id, provider }) {
    const nativeId = provider?.sessionId ?? id;
    const rpc = await startCodexClient();
    const thread = await readThreadHistory(rpc, nativeId);
    const subagents = await Promise.all(
      thread.turns
        .flatMap((turn) => turn.items.flatMap((item) => subagentThreadId(item) ?? []))
        .map(async (threadId) => [
          ...(await readThreadHistory(rpc, threadId).then(codexHistoryEvents, () => [])),
          // Closed or unreadable subagent threads still complete their agent cards.
          { method: "thread/closed" as const, params: { threadId } },
        ]),
    );
    return [...codexHistoryEvents(thread), ...subagents.flat()].flatMap(
      createCodexProjector(id, thread.id),
    );
  },
  async listSessions() {
    const rpc = await startCodexClient();
    const sessions: Thread[] = [];
    let cursor: string | null = null;
    do {
      const page: ThreadListResponse = await rpc.request("thread/list", {
        cursor,
        limit: 100,
        sourceKinds: ["cli", "vscode", "exec", "appServer"],
        sortKey: "updated_at",
        useStateDbOnly: true,
      });
      sessions.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return sessions.map((thread) => ({
      id: thread.id,
      createdAt: new Date(thread.createdAt * 1000),
      updatedAt: new Date(thread.updatedAt * 1000),
      title: thread.name ?? thread.preview,
      context: {
        directory: threadDirectory(thread),
        // Codex reports Git membership but not its root; directory lookup resolves the actual root.
        gitRoot: thread.gitInfo ? thread.cwd : undefined,
        repository: thread.gitInfo?.originUrl ?? undefined,
        branch: thread.gitInfo?.branch ?? undefined,
      },
    }));
  },
  async create(sessionId, configuration) {
    const rpc = await startCodexClient();
    const skills = await listSkills(configuration.directory, configuration.skillDirectories);
    const result = await rpc.request("thread/start", {
      ...nativeConfiguration(configuration, skills),
      dynamicTools: [
        {
          type: "namespace",
          name: "toy_box",
          description: "Toy Box sessions, apps, files, and workspace tools.",
          tools: configuration.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: (tool.parameters?.toJSONSchema() ?? {
              type: "object",
              properties: {},
            }) as JsonValue,
            deferLoading: !tool.alwaysLoad,
          })),
        },
      ],
    });
    const connection = new CodexConnection(
      rpc,
      { id: sessionId, provider: { id: "codex", sessionId: result.thread.id } },
      configuration,
      codexModel(result.model, result.reasoningEffort),
      skills,
    );
    try {
      if (configuration.name) await connection.rename(configuration.name);
      return connection;
    } catch (error) {
      await connection.disconnect();
      await rpc.request("thread/delete", { threadId: result.thread.id }).catch(console.error);
      throw error;
    }
  },
  async resume(session, configuration) {
    const rpc = await startCodexClient();
    const skills = await listSkills(configuration.directory, configuration.skillDirectories);
    const result = await rpc.request("thread/resume", {
      threadId: session.provider?.sessionId ?? session.id,
      ...nativeConfiguration(configuration, skills),
      excludeTurns: true,
    });
    return new CodexConnection(
      rpc,
      session,
      configuration,
      codexModel(result.model, result.reasoningEffort),
      skills,
    );
  },
  async readDirectory(nativeId) {
    const { thread } = await (
      await startCodexClient()
    ).request("thread/read", { threadId: nativeId });
    return threadDirectory(thread);
  },
  async isHistoryCurrent(nativeId, capturedAt) {
    const { thread } = await (
      await startCodexClient()
    ).request("thread/read", { threadId: nativeId });
    // Native timestamps have second precision. A snapshot captured during
    // that second must be replayed before we can trust it as a cache.
    return (thread.updatedAt + 1) * 1000 <= capturedAt;
  },
  async delete(nativeId) {
    await (await startCodexClient()).request("thread/delete", { threadId: nativeId });
  },
  stop: stopCodexClient,
};

/** Codex plans meter rolling windows, some per model; credits are a separate balance. */
export function toSubscription({
  rateLimits,
  rateLimitsByLimitId,
}: GetAccountRateLimitsResponse): ProviderSubscription | undefined {
  if (!rateLimits.planType) return undefined;
  // `rateLimits` mirrors the main bucket; every other bucket meters the model it names.
  const modelBuckets = Object.entries(rateLimitsByLimitId ?? {}).filter(
    ([limitId]) => limitId !== rateLimits.limitId,
  );
  return {
    plan: rateLimits.planType,
    limits: [
      ...windowLimits(rateLimits),
      ...modelBuckets.flatMap(([limitId, bucket]) =>
        bucket ? windowLimits(bucket, bucket.limitName ?? limitId) : [],
      ),
    ],
  };
}

function windowLimits({ primary, secondary }: RateLimitSnapshot, model?: string) {
  return [primary, secondary]
    .filter((window) => window !== null)
    .map((window) => ({
      name: [windowName(window.windowDurationMins), model].filter(Boolean).join(" "),
      usedPercent: window.usedPercent,
      ...(window.resetsAt ? { resetsAt: window.resetsAt * 1000 } : {}),
    }));
}

function windowName(minutes: number | null): string {
  if (!minutes) return "Usage";
  if (minutes === 7 * 24 * 60) return "Weekly";
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day`;
  return `${Math.round(minutes / 60)}-hour`;
}

function nativeConfiguration(
  configuration: SessionConfiguration,
  skills: readonly SessionSkill[],
): ThreadStartParams {
  const bundled = skills.filter((skill) =>
    configuration.skillDirectories.some((root) => skill.path === join(root, "SKILL.md")),
  );
  return {
    model: configuration.model?.name,
    cwd: configuration.directory,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    developerInstructions: [
      configuration.instructions,
      "Toy Box tools are provided in the toy_box namespace. Discover its tools when they are not already in your tool context. A successful terminal tool completes your turn; do not take further actions after it.",
      ...bundled.map(
        (skill) =>
          `Skill ${skill.name}: ${skill.description}. Read ${skill.path} when this skill applies.`,
      ),
    ].join("\n\n"),
    config: {
      // Only interactive sessions may ask. The tool switch also removes asynchronous
      // questions; the feature adds blocking questions to the default mode.
      "tools.experimental_request_user_input.enabled": configuration.allowUserQuestions,
      "features.default_mode_request_user_input": configuration.allowUserQuestions,
      // Agent cards follow V2 subagent activity, so models that default to V1 opt in.
      "features.multi_agent_v2": true,
      // A preempted reply never reaches history, so steering waits for the reply to finish.
      "features.instant_interrupt": false,
      // Recent CLIs leave the checklist tool disabled unless the host opts in.
      "tools.update_plan.enabled": true,
      ...(configuration.model?.reasoningEffort
        ? { model_reasoning_effort: configuration.model.reasoningEffort }
        : {}),
      ...(configuration.disableMemory ? { "features.memories": false } : {}),
    },
  };
}

async function listSkills(
  directory: string | undefined,
  skillDirectories: readonly string[],
): Promise<SessionSkill[]> {
  const { data } = await (
    await startCodexClient()
  ).request("skills/list", { cwds: [directory ?? homedir()] });
  const skills: SessionSkill[] = data.flatMap((entry) =>
    entry.skills
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.path,
        type: skill.scope === "repo" ? ("project" as const) : ("global" as const),
      })),
  );
  for (const root of skillDirectories) {
    const path = join(root, "SKILL.md");
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const frontmatter = (await file.text()).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const { name, description = "" } = (Bun.YAML.parse(frontmatter) ?? {}) as Partial<SessionSkill>;
    if (name && !skills.some((skill) => skill.name === name))
      skills.push({ name, description, path, type: "global" });
  }
  return skills;
}

function threadDirectory(thread: Thread): string | undefined {
  if (thread.cwd === homedir() && !thread.gitInfo) return undefined;
  return thread.cwd;
}

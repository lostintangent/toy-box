import type { JsonValue, ModelListResponse, ThreadListResponse } from "./protocol";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionConfiguration, SessionProvider } from "@providers/server/provider";
import type { SessionEvent, SessionSkill } from "@sessions/model";
import { startCodexClient, stopCodexClient, type CodexTransport } from "./protocol/transport";
import { CodexConnection } from "./connection";
import { readThreadHistory } from "./history";
import {
  codexHistoryEvents,
  createCodexProjector,
  isCodexSubagentSpawn,
  scopeCodexSubagentEvent,
} from "./projector";
import type { Model, Thread, ThreadStartParams } from "./protocol";

export const codexProvider: SessionProvider = {
  id: "codex",
  name: "OpenAI Codex",
  isInstalled: () => !!Bun.which("codex"),
  async listModels() {
    const rpc = await startCodexClient();
    const auth = await rpc.request("account/read", {});
    if (auth.requiresOpenaiAuth && !auth.account)
      throw new Error("Run `codex login` to sign in to Codex, then refresh Toy Box.");
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
  listSkills,
  async readHistory({ sessionId, nativeId }) {
    const rpc = await startCodexClient();
    const thread = await readThreadHistory(rpc, nativeId);
    const subagentCalls = thread.turns.flatMap((turn) =>
      turn.items.flatMap((item) =>
        isCodexSubagentSpawn(item) && item.status === "completed" && item.receiverThreadIds.length
          ? [{ toolCallId: item.id, threadIds: item.receiverThreadIds }]
          : [],
      ),
    );
    return [
      ...codexHistoryEvents(thread).flatMap(createCodexProjector(sessionId)),
      ...(await readSubagentHistory(rpc, sessionId, subagentCalls)),
    ];
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
      sessionId: thread.id,
      startTime: new Date(thread.createdAt * 1000),
      modifiedTime: new Date(thread.updatedAt * 1000),
      title: thread.name ?? thread.preview,
      directory: threadDirectory(thread),
      // Codex reports Git membership but not its root; directory lookup resolves the actual root.
      gitRoot: thread.gitInfo ? thread.cwd : undefined,
      repository: thread.gitInfo?.originUrl ?? undefined,
      branch: thread.gitInfo?.branch ?? undefined,
    }));
  },
  async create(sessionId, configuration) {
    const rpc = await startCodexClient();
    const skills = await listSkills(configuration.directory, configuration.skillDirectories);
    const result = await rpc.request("thread/start", {
      ...nativeConfiguration(configuration, skills),
      historyMode: "paginated",
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
            deferLoading: true,
          })),
        },
      ],
    });
    return new CodexConnection(
      rpc,
      { sessionId, nativeId: result.thread.id, providerId: "codex" },
      configuration,
      {
        provider: "codex",
        name: result.model,
        ...(result.reasoningEffort ? { reasoningEffort: result.reasoningEffort } : {}),
      },
      skills,
    );
  },
  async resume(identity, configuration) {
    const rpc = await startCodexClient();
    const skills = await listSkills(configuration.directory, configuration.skillDirectories);
    const result = await rpc.request("thread/resume", {
      threadId: identity.nativeId,
      ...nativeConfiguration(configuration, skills),
      excludeTurns: true,
    });
    return new CodexConnection(
      rpc,
      identity,
      configuration,
      {
        provider: "codex",
        name: result.model,
        ...(result.reasoningEffort ? { reasoningEffort: result.reasoningEffort } : {}),
        ...configuration.model,
      },
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
    // Paginated history may live in the native state database. updatedAt is
    // authoritative there; legacy rollouts expose their actual file mtime.
    if (thread.historyMode === "legacy" && thread.path) {
      try {
        return (await stat(thread.path)).mtimeMs <= capturedAt;
      } catch {
        return false;
      }
    }
    // Native database timestamps have second precision. A snapshot captured
    // during that second must be replayed before we can trust it as a cache.
    return (thread.updatedAt + 1) * 1000 <= capturedAt;
  },
  async delete(nativeId) {
    await (await startCodexClient()).request("thread/delete", { threadId: nativeId });
  },
  stop: stopCodexClient,
};

async function readSubagentHistory(
  rpc: CodexTransport,
  sessionId: string,
  calls: Array<{ toolCallId: string; threadIds: string[] }>,
): Promise<SessionEvent[]> {
  const histories = await Promise.all(
    calls.map(async ({ toolCallId, threadIds }) => {
      const threads = (
        await Promise.all(
          threadIds.map(async (threadId) => {
            try {
              return await readThreadHistory(rpc, threadId);
            } catch {
              // A closed native child must not make its root history unreadable.
              return undefined;
            }
          }),
        )
      ).filter((thread): thread is Thread => thread !== undefined);
      const failedTurn = threads
        .map((thread) => thread.turns[0])
        .find((turn) => turn?.status === "failed");
      const activity = threads.flatMap((thread) => {
        const initialTurn = thread.turns[0];
        if (!initialTurn) return [];

        const project = createCodexProjector(sessionId);
        const scope = (event: SessionEvent) => {
          const scoped = scopeCodexSubagentEvent(event, toolCallId);
          return scoped ? [scoped] : [];
        };
        return [
          ...project({ method: "thread/started", params: { thread } }).flatMap(scope),
          ...project({
            method: "turn/completed",
            params: { threadId: thread.id, turn: initialTurn },
          }).flatMap(scope),
        ];
      });

      return [
        ...activity,
        {
          type: "tool_end" as const,
          toolCallId,
          success: failedTurn === undefined,
          ...(failedTurn?.error?.message ? { result: failedTurn.error.message } : {}),
        },
      ];
    }),
  );
  return histories.flat();
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
      "features.default_mode_request_user_input": configuration.allowUserQuestions,
      // Recent CLIs leave the checklist tool disabled unless the host opts in.
      "tools.update_plan.enabled": true,
      ...(configuration.model?.reasoningEffort
        ? { model_reasoning_effort: configuration.model.reasoningEffort }
        : {}),
      ...(configuration.disableMemory ? { "features.memory_tool": false } : {}),
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
    const markdown = await file.text();
    const name = markdown
      .match(/^name:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    const description =
      markdown
        .match(/^description:\s*(.+)$/m)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "") ?? "";
    if (name && !skills.some((skill) => skill.name === name))
      skills.push({ name, description, path, type: "global" });
  }
  return skills;
}

function threadDirectory(thread: Thread): string | undefined {
  if (thread.cwd === homedir() && !thread.gitInfo) return undefined;
  return thread.cwd;
}

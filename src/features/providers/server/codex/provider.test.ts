import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "@sessions/server/tools/definition";
import type { SessionConfiguration, SessionConnection } from "@providers/server/provider";
import * as transport from "./protocol/transport";
import { codexProvider, toSubscription } from "./provider";
import type { GetAccountRateLimitsResponse, RateLimitSnapshot } from "./protocol";

const rateLimits: RateLimitSnapshot = {
  limitId: "codex",
  limitName: null,
  normalModelSlug: null,
  primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_792_210_200 },
  secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: 1_792_684_926 },
  credits: { hasCredits: true, unlimited: false, balance: "34965.6" },
  individualLimit: null,
  spendControlReached: false,
  planType: "pro",
  rateLimitReachedType: null,
};
const response = (
  rateLimitsByLimitId: GetAccountRateLimitsResponse["rateLimitsByLimitId"],
  main = rateLimits,
): GetAccountRateLimitsResponse => ({
  ordinaryUsageAllowed: true,
  rateLimits: main,
  rateLimitsByLimitId,
  rateLimitResetCredits: null,
  accountId: null,
  rateLimitUpsell: null,
});

test("a subscription names its plan and each window it meters, then each model's", () => {
  const spark: RateLimitSnapshot = {
    ...rateLimits,
    limitId: "codex_spark",
    limitName: "GPT-5.3-Codex-Spark",
    primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_792_210_200 },
    secondary: null,
  };

  expect(toSubscription(response({ codex: rateLimits, codex_spark: spark }))).toEqual({
    plan: "pro",
    limits: [
      { name: "5-hour", usedPercent: 40, resetsAt: 1_792_210_200_000 },
      { name: "Weekly", usedPercent: 12, resetsAt: 1_792_684_926_000 },
      { name: "5-hour GPT-5.3-Codex-Spark", usedPercent: 30, resetsAt: 1_792_210_200_000 },
    ],
  });
  expect(
    toSubscription(
      response(null, {
        ...rateLimits,
        primary: { usedPercent: 0, windowDurationMins: null, resetsAt: null },
        secondary: null,
      }),
    ),
  ).toEqual({ plan: "pro", limits: [{ name: "Usage", usedPercent: 0 }] });
});

test("an account without a plan has no subscription", () => {
  expect(toSubscription(response(null, { ...rateLimits, planType: null }))).toBeUndefined();
});

test("catalog metadata retains the native repository display fields", async () => {
  const rpc = new transport.CodexTransport((line) => {
    const { id } = JSON.parse(line);
    queueMicrotask(() =>
      rpc.receive(
        JSON.stringify({
          id,
          result: {
            data: [
              {
                id: "native",
                createdAt: 0,
                updatedAt: 1,
                name: "Repository session",
                cwd: "/repo",
                gitInfo: { sha: null, branch: "main", originUrl: "git@github.com:owner/repo.git" },
              },
            ],
            nextCursor: null,
          },
        }) + "\n",
      ),
    );
  });
  const start = spyOn(transport, "startCodexClient").mockResolvedValue(rpc);
  onTestFinished(() => {
    start.mockRestore();
    rpc.close();
  });

  expect(await codexProvider.listSessions()).toEqual([
    {
      id: "native",
      createdAt: new Date(0),
      updatedAt: new Date(1000),
      title: "Repository session",
      context: {
        directory: "/repo",
        gitRoot: "/repo",
        repository: "git@github.com:owner/repo.git",
        branch: "main",
      },
    },
  ]);
});

test("history reads every stored turn page without acquiring the thread's writer", async () => {
  const written: string[] = [];
  const rpc = new transport.CodexTransport((line) => {
    const { id, method, params } = JSON.parse(line);
    written.push(method);
    if (method !== "thread/read" && method !== "thread/turns/list") {
      queueMicrotask(() =>
        rpc.receive(
          JSON.stringify({
            id,
            error: { code: -32000, message: "thread already has an active writer" },
          }) + "\n",
        ),
      );
      return;
    }
    const page = params.cursor ? 2 : 1;
    const result =
      method === "thread/read"
        ? { thread: { id: "native", turns: [] } }
        : {
            data: [
              {
                id: `turn-${page}`,
                startedAt: page,
                status: "completed",
                error: null,
                items: [
                  {
                    type: "userMessage",
                    id: `message-${page}`,
                    content: [{ type: "text", text: `Page ${page}`, text_elements: [] }],
                  },
                ],
              },
            ],
            nextCursor: page === 1 ? "next" : null,
          };
    queueMicrotask(() => rpc.receive(JSON.stringify({ id, result }) + "\n"));
  });
  const start = spyOn(transport, "startCodexClient").mockResolvedValue(rpc);
  onTestFinished(() => {
    start.mockRestore();
    rpc.close();
  });
  const events = await codexProvider.readHistory({
    id: "public",
    provider: { id: "codex", sessionId: "native" },
  });
  expect(
    events.filter((event) => event.type === "user_message").map((event) => event.content),
  ).toEqual(["Page 1", "Page 2"]);
  expect(written).toEqual(["thread/read", "thread/turns/list", "thread/turns/list"]);
});

test("resumed threads apply the current workspace, model, and session skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "toy-box-codex-skills-"));
  const nextDirectory = join(root, "next");
  await mkdir(nextDirectory);
  await Bun.write(
    join(root, "SKILL.md"),
    "---\nname: session-skill\ndescription: Session-specific skill\n---\n",
  );
  const written: { method: string; params: Record<string, unknown> }[] = [];
  const connections: SessionConnection[] = [];
  const thread = {
    id: "native",
    cwd: root,
    gitInfo: null,
  };
  const rpc = new transport.CodexTransport((line) => {
    const request = JSON.parse(line);
    written.push(request);
    const result =
      request.method === "skills/list"
        ? { data: [] }
        : {
            thread,
            model: request.params.model ?? "model",
            reasoningEffort: request.params.config?.model_reasoning_effort ?? "low",
          };
    queueMicrotask(() => rpc.receive(JSON.stringify({ id: request.id, result }) + "\n"));
  });
  spyOn(transport, "startCodexClient").mockResolvedValue(rpc);
  onTestFinished(async () => {
    for (const connection of connections) await connection.disconnect();
    rpc.close();
    mock.restore();
    await rm(root, { recursive: true, force: true });
  });
  const configuration: SessionConfiguration = {
    directory: root,
    allowUserQuestions: true,
    tools: [
      defineTool("echo", {
        description: "Echo a value",
        parameters: z.object({ value: z.string() }),
        handler: ({ value }) => value,
      }),
      defineTool("finish", { alwaysLoad: true, handler: () => "Done" }),
    ],
    instructions: "Session instructions",
    skillDirectories: [root],
  };
  expect(await codexProvider.listSkills(root, [root])).toEqual([
    {
      name: "session-skill",
      description: "Session-specific skill",
      path: join(root, "SKILL.md"),
      type: "global",
    },
  ]);
  const created = await codexProvider.create("public", configuration);
  connections.push(created);
  await created.disconnect();
  const resumed = await codexProvider.resume(
    { id: "public", provider: created.provider },
    {
      ...configuration,
      directory: nextDirectory,
      model: { provider: "codex", name: "next-model", reasoningEffort: "high" },
    },
  );
  connections.push(resumed);
  await resumed.send({ role: "user", clientId: "next-message", content: "Continue" });
  const requests = written.filter(
    ({ method }) => method === "thread/start" || method === "thread/resume",
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]!.params.dynamicTools).toMatchObject([
    {
      type: "namespace",
      name: "toy_box",
      tools: [
        {
          type: "function",
          name: "echo",
          deferLoading: true,
          inputSchema: { properties: { value: { type: "string" } } },
        },
        { type: "function", name: "finish", deferLoading: false },
      ],
    },
  ]);
  expect(requests[1]!.params).not.toHaveProperty("dynamicTools");
  expect(requests[0]!.params.cwd).toBe(root);
  expect(requests[1]!.params).toMatchObject({
    cwd: nextDirectory,
    model: "next-model",
    config: { model_reasoning_effort: "high" },
  });
  expect(written.find(({ method }) => method === "turn/start")?.params).toMatchObject({
    model: "next-model",
    effort: "high",
  });
  for (const { params } of requests) {
    expect(params.config).toMatchObject({
      "tools.update_plan.enabled": true,
      "tools.experimental_request_user_input.enabled": true,
      "features.default_mode_request_user_input": true,
      "features.multi_agent_v2": true,
      "features.instant_interrupt": false,
    });
    expect(params.developerInstructions).toContain(`Read ${join(root, "SKILL.md")}`);
  }
  const background = await codexProvider.create("background", {
    ...configuration,
    allowUserQuestions: false,
  });
  connections.push(background);
  expect(
    written.filter(({ method }) => method === "thread/start").at(-1)?.params.config,
  ).toMatchObject({
    "tools.experimental_request_user_input.enabled": false,
    "features.default_mode_request_user_input": false,
  });
});

test("second-precision native timestamps cannot hide edits made during snapshot capture", async () => {
  let updatedAt = 100;
  const rpc = new transport.CodexTransport((line) => {
    const { id } = JSON.parse(line);
    queueMicrotask(() =>
      rpc.receive(JSON.stringify({ id, result: { thread: { updatedAt } } }) + "\n"),
    );
  });
  spyOn(transport, "startCodexClient").mockResolvedValue(rpc);
  onTestFinished(() => {
    mock.restore();
    rpc.close();
  });
  expect(await codexProvider.isHistoryCurrent("native", 100_500)).toBe(false);
  expect(await codexProvider.isHistoryCurrent("native", 101_000)).toBe(true);
  updatedAt = 101;
  expect(await codexProvider.isHistoryCurrent("native", 101_000)).toBe(false);
});

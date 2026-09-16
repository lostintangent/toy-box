import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "@sessions/server/tools/definition";
import type { SessionConfiguration, SessionConnection } from "@providers/server/provider";
import * as transport from "./protocol/transport";
import { codexProvider } from "./provider";

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
      sessionId: "native",
      startTime: new Date(0),
      modifiedTime: new Date(1000),
      title: "Repository session",
      directory: "/repo",
      gitRoot: "/repo",
      repository: "git@github.com:owner/repo.git",
      branch: "main",
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
        ? { thread: { id: "native", historyMode: "paginated", turns: [] } }
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
    sessionId: "public",
    nativeId: "native",
    providerId: "codex",
  });
  expect(
    events.filter((event) => event.type === "user_message").map((event) => event.content),
  ).toEqual(["Page 1", "Page 2"]);
  expect(written).toEqual(["thread/read", "thread/turns/list", "thread/turns/list"]);
});

test("new and resumed threads expose native plans and the configured session skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "toy-box-codex-skills-"));
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
        : { thread, model: "model", reasoningEffort: "low" };
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
    attachmentsDirectory: join(root, "attachments"),
    tools: [
      defineTool("echo", {
        description: "Echo a value",
        parameters: z.object({ value: z.string() }),
        handler: ({ value }) => value,
      }),
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
  connections.push(await codexProvider.resume(created.identity, configuration));
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
      ],
    },
  ]);
  expect(requests[1]!.params).not.toHaveProperty("dynamicTools");
  for (const { params } of requests) {
    expect(params.cwd).toBe(root);
    expect(params.config).toMatchObject({
      "tools.update_plan.enabled": true,
      "features.default_mode_request_user_input": true,
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
    "features.default_mode_request_user_input": false,
  });
});

test("second-precision native timestamps cannot hide edits made during snapshot capture", async () => {
  let updatedAt = 100;
  const rpc = new transport.CodexTransport((line) => {
    const { id } = JSON.parse(line);
    queueMicrotask(() =>
      rpc.receive(
        JSON.stringify({ id, result: { thread: { historyMode: "paginated", updatedAt } } }) + "\n",
      ),
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

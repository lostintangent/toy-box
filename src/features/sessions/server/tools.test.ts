import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  onTestFinished,
  spyOn,
  test,
} from "bun:test";
import { z } from "zod";
import * as streamModule from "@sessions/server/runtime";
import * as registryModule from "@sessions/server/state/registry";
import type { ToolInvocation } from "@sessions/server/tools/definition";
import * as modelProviders from "@providers/server";
import * as providers from "./providers";

const realStreamModule = { ...streamModule };
const realRegistryModule = { ...registryModule };

type CreateSessionArguments = Parameters<typeof streamModule.createSession>;
type DeliverSessionMessageArguments = Parameters<typeof streamModule.deliverSessionMessage>;

const createSessionMock = mock(async (..._args: CreateSessionArguments) => ({
  disposition: "started" as const,
  waitForCompletion: async () => ({ status: "completed" as const }),
}));
const deliverSessionMessageMock = mock(async (..._args: DeliverSessionMessageArguments) => ({
  disposition: "queued" as const,
  waitForCompletion: async () => ({ status: "completed" as const }),
}));
mock.module("@sessions/server/runtime", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
  deliverSessionMessage: deliverSessionMessageMock,
}));
const updateSessionTitleMock = mock(async (_sessionId: string, _title: string) => true);
mock.module("@sessions/server/state/registry", () => ({
  ...realRegistryModule,
  updateSessionTitle: updateSessionTitleMock,
}));

const {
  coordinationTools,
  hyperLifecycleTools,
  modelTools,
  sessionTitleTools,
  sessionHistoryTools,
} = await import("./tools");

test("model discovery returns the client catalog with provider and option metadata", async () => {
  const catalog = [
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      provider: "copilot",
      providerName: "GitHub Copilot",
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
      supportedContextTiers: [
        { name: "default", tokenWindow: 128_000 },
        { name: "long_context", tokenWindow: 1_000_000 },
      ],
    },
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      provider: "codex",
      providerName: "OpenAI Codex",
      supportedReasoningEfforts: ["medium", "high", "max"],
      defaultReasoningEffort: "medium",
    },
  ];
  const list = spyOn(modelProviders, "listModels").mockResolvedValue(catalog);
  onTestFinished(() => list.mockRestore());

  const [tool] = modelTools;
  expect(await tool.handler({ provider: undefined }, invocation(tool.name))).toEqual(catalog);
  expect(await tool.handler({ provider: "codex" }, invocation(tool.name))).toEqual([catalog[1]]);
  expect(tool.parameters?.safeParse({ provider: "other" }).success).toBe(false);
});

test("session discovery bounds results and searches titles across providers, newest first", async () => {
  const list = spyOn(providers, "listSessions").mockResolvedValue([
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `session-${index}`,
      provider: { id: index % 3 ? "codex" : "copilot" },
      title: index % 2 ? "Other session" : "Mobile Pager Dots",
      createdAt: new Date(index),
      updatedAt: new Date(index),
    })),
    { id: "draft", createdAt: new Date(30), updatedAt: new Date(30) },
  ]);
  onTestFinished(() => list.mockRestore());
  const tool = sessionHistoryTools[0];
  const all = (await tool.handler({}, invocation(tool.name))) as {
    sessions: { id: string; provider: { id: string } }[];
    total: number;
  };
  expect(all.total).toBe(25);
  expect(all.sessions).toHaveLength(20);
  expect(all.sessions[0]?.id).toBe("session-24");
  const filtered = await tool.handler({ query: " PAGER ", limit: 2 }, invocation(tool.name));
  expect(filtered).toMatchObject({
    total: 13,
    sessions: [
      { id: "session-24", provider: { id: "copilot" } },
      { id: "session-22", provider: { id: "codex" } },
    ],
  });
  expect(tool.parameters?.safeParse({ limit: 101 }).success).toBe(false);
});

afterAll(() => {
  mock.module("@sessions/server/runtime", () => realStreamModule);
  mock.module("@sessions/server/state/registry", () => realRegistryModule);
});

beforeEach(() => {
  createSessionMock.mockClear();
  deliverSessionMessageMock.mockClear();
  updateSessionTitleMock.mockClear();
});

describe("SDK coordination tools", () => {
  const deliverMessageTool = coordinationTools[2];

  test("rejects self-delivery instead of turning a subagent reply into a new root prompt", async () => {
    await expect(
      deliverMessageTool.handler(
        { sessionId: "toy-box-caller", message: "Ownership returned to parent." },
        invocation("deliver_message"),
      ),
    ).rejects.toThrow("cannot target the invoking session");
    expect(deliverSessionMessageMock).not.toHaveBeenCalled();
  });

  test("uses the source tool call as cross-session delivery identity", async () => {
    const result = await deliverMessageTool.handler(
      { sessionId: "toy-box-recipient", message: "Please review this", model: undefined },
      invocation("deliver_message"),
    );

    expect(deliverSessionMessageMock).toHaveBeenCalledWith("toy-box-recipient", {
      clientId: "tool-call",
      content: "Please review this",
      model: undefined,
    });
    expect(JSON.parse(String(result))).toEqual({ disposition: "queued" });
  });
});

describe("SDK session title tool", () => {
  test("updates the invoking session through automatic-name policy", async () => {
    const [tool] = sessionTitleTools;

    const result = await tool?.handler?.(
      { title: "Terminal Reconnect Scrollback" },
      invocation("update_session_title"),
    );

    expect(updateSessionTitleMock).toHaveBeenCalledWith(
      "toy-box-caller",
      "Terminal Reconnect Scrollback",
    );
    expect(JSON.parse(String(result))).toEqual({ applied: true });
  });
});

describe("SDK lifecycle tools", () => {
  test("create_session creates a standard session without inherited defaults or a worker owner", async () => {
    const tool = hyperLifecycleTools.find((candidate) => candidate.name === "create_session");

    const result = await tool?.handler?.(
      { prompt: "Start a durable investigation" },
      invocation("create_session"),
    );

    const { sessionId, opened } = JSON.parse(String(result)) as {
      sessionId: string;
      opened: boolean;
    };
    expect(z.uuid().safeParse(sessionId).success).toBe(true);
    expect(opened).toBe(false);
    expect(createSessionMock).toHaveBeenCalledWith(
      sessionId,
      { content: "Start a durable investigation", model: undefined },
      {
        directory: undefined,
        sessionType: "standard",
        useWorktree: false,
      },
    );
    expect(createSessionMock.mock.calls[0]?.[2]).not.toHaveProperty("worker");
  });

  test("create_session honors explicit execution options and can open the new session", async () => {
    const tool = hyperLifecycleTools.find((candidate) => candidate.name === "create_session");
    const model = { provider: "copilot", name: "claude-sonnet-4.5" };

    const result = await tool?.handler?.(
      {
        prompt: "Work elsewhere",
        model,
        directory: "/other",
        useWorktree: true,
        open: true,
      },
      invocation("create_session"),
    );

    expect(JSON.parse(String(result))).toEqual({
      sessionId: createSessionMock.mock.calls[0]?.[0],
      opened: true,
    });
    expect(createSessionMock.mock.calls[0]?.[1]).toEqual({ content: "Work elsewhere", model });
    expect(createSessionMock.mock.calls[0]?.[2]).toEqual({
      directory: "/other",
      sessionType: "standard",
      useWorktree: true,
    });
  });
});

function invocation(toolName: string): ToolInvocation {
  return {
    sessionId: "toy-box-caller",
    toolCallId: "tool-call",
    toolName,
    arguments: {},
  };
}

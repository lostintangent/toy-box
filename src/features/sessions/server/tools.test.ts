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
import type { ToolInvocation } from "@github/copilot-sdk";
import * as streamModule from "@sessions/server/runtime";
import * as registryModule from "@sessions/server/state/registry";
import * as providers from "./providers";

const realStreamModule = { ...streamModule };
const realRegistryModule = { ...registryModule };

type CreateSessionArguments = Parameters<typeof streamModule.createSession>;

const createSessionMock = mock(async (..._args: CreateSessionArguments) => ({
  disposition: "started" as const,
  waitForCompletion: async () => ({ status: "completed" as const }),
}));
mock.module("@sessions/server/runtime", () => ({
  ...realStreamModule,
  createSession: createSessionMock,
}));
const updateSessionTitleMock = mock(async (_sessionId: string, _title: string) => true);
mock.module("@sessions/server/state/registry", () => ({
  ...realRegistryModule,
  updateSessionTitle: updateSessionTitleMock,
}));

const { hyperLifecycleTools, sessionTitleTools, sessionHistoryTools } = await import("./tools");

test("session discovery bounds results and searches titles across providers, newest first", async () => {
  const list = spyOn(providers, "listSessions").mockResolvedValue(
    Array.from({ length: 25 }, (_, index) => ({
      sessionId: `session-${index}`,
      provider: index % 3 ? "codex" : "copilot",
      title: index % 2 ? "Other session" : "Mobile Pager Dots",
      startTime: new Date(index),
      modifiedTime: new Date(index),
    })),
  );
  onTestFinished(() => list.mockRestore());
  const tool = sessionHistoryTools[0];
  const all = (await tool.handler({}, invocation(tool.name))) as {
    sessions: { sessionId: string; provider: string }[];
    total: number;
  };
  expect(all.total).toBe(25);
  expect(all.sessions).toHaveLength(20);
  expect(all.sessions[0]?.sessionId).toBe("session-24");
  const filtered = await tool.handler({ query: " PAGER ", limit: 2 }, invocation(tool.name));
  expect(filtered).toMatchObject({
    total: 13,
    sessions: [
      { sessionId: "session-24", provider: "copilot" },
      { sessionId: "session-22", provider: "codex" },
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
  updateSessionTitleMock.mockClear();
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
    expect(sessionId).toStartWith("toy-box-");
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
      sessionId: expect.stringMatching(/^toy-box-/),
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

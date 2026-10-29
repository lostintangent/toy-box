import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { applySessionEvent, createInitialSessionState } from "@sessions/model/reducer";
import { computeFileDiffStats, getToolCallFileDiffs } from "@sessions/model/fileDiffs";
import { getModelReasoningConfig, modelCatalogKey, modelConfigurationKey } from "@providers/model";
import { createClaudeProjector } from "./projector";
import { asLiveStream } from "./history";
import { toModelInfo } from "./models";

const native = (value: unknown) => value as SDKMessage;
const assistant = (content: unknown[], id = "reply", parent_tool_use_id: string | null = null) =>
  native({
    type: "assistant",
    message: { id, model: "claude-model", content },
    parent_tool_use_id,
  });
/** The CLI authors these messages itself, such as API errors after retries. */
const synthetic = (text: string, error?: string) =>
  native({
    type: "assistant",
    message: { model: "<synthetic>", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    error,
  });
const prompt = native({
  type: "user",
  message: { role: "user", content: "Say hi" },
  parent_tool_use_id: null,
  origin: { kind: "human" },
});
const replay = (messages: SDKMessage[]) =>
  messages
    .flatMap(createClaudeProjector("test"))
    .reduce(applySessionEvent, createInitialSessionState());

test("catalog, startup, and history agree on the model and its reasoning options", () => {
  const catalog = [
    toModelInfo({
      value: "opus[1m]",
      resolvedModel: "claude-opus-5-5[1m]",
      displayName: "Opus 5.5",
      description: "",
      supportedEffortLevels: ["low", "high"],
    }),
  ];
  const messages = [
    native({ type: "system", subtype: "init", model: "claude-opus-5-5[1m]" }),
    ...["claude-opus-5-5", "claude-opus-5-5[1M]"].map((model) =>
      native({
        type: "assistant",
        message: { id: "reply", model, content: [{ type: "text", text: "Done." }] },
        effort: "high",
      }),
    ),
  ];
  for (const message of messages) {
    const state = createClaudeProjector("test")(message).reduce(
      applySessionEvent,
      createInitialSessionState(),
    );
    expect(state.model?.name).toBe("claude-opus-5-5");
    const selected = catalog.find(
      (model) => modelCatalogKey(model) === modelConfigurationKey(state.model!),
    );
    expect(selected?.name).toBe("Opus 5.5");
    expect(getModelReasoningConfig(selected, state.model?.reasoningEffort)).toEqual({
      supportedReasoningEfforts: ["low", "high"],
      reasoningEffort: message.type === "assistant" ? "high" : "low",
    });
  }
});

test("turn results do not finish a session before native idle", () => {
  const project = createClaudeProjector("test");
  expect(project(native({ type: "result", subtype: "success", is_error: false }))).toEqual([]);
  expect(
    project(native({ type: "system", subtype: "session_state_changed", state: "idle" })),
  ).toEqual([{ type: "end", reason: "idle" }]);
});

test("turn results report the main thread's latest request against its model's context window", () => {
  const project = createClaudeProjector("test");
  const reply = (model: string, input_tokens: number, parent_tool_use_id: string | null = null) =>
    native({
      type: "assistant",
      message: {
        id: `${model}-${input_tokens}`,
        model,
        content: [],
        usage: {
          input_tokens,
          cache_read_input_tokens: 20_000,
          cache_creation_input_tokens: 1_000,
          output_tokens: 500,
        },
      },
      parent_tool_use_id,
    });
  for (const message of [
    reply("claude-sonnet-5", 2_000),
    reply("claude-sonnet-5", 4_000),
    reply("claude-haiku-5-5", 90_000, "agent-1"),
  ])
    project(message);

  expect(
    project(
      native({
        type: "result",
        subtype: "success",
        is_error: false,
        modelUsage: {
          "claude-haiku-5-5": { contextWindow: 200_000 },
          "claude-sonnet-5": { contextWindow: 1_000_000 },
        },
      }),
    ),
  ).toEqual([{ type: "context_usage_changed", usage: { tokens: 25_500, tokenWindow: 1_000_000 } }]);
});

test("turn results find a 1M model's context window under its suffixed usage key", () => {
  const project = createClaudeProjector("test");
  project(
    native({
      type: "assistant",
      message: {
        id: "reply",
        model: "claude-opus-4-6",
        content: [],
        usage: { input_tokens: 30_000, output_tokens: 500 },
      },
      parent_tool_use_id: null,
    }),
  );

  expect(
    project(
      native({
        type: "result",
        subtype: "success",
        is_error: false,
        modelUsage: {
          "claude-haiku-5-5": { contextWindow: 200_000 },
          "claude-opus-4-6[1m]": { contextWindow: 1_000_000 },
        },
      }),
    ),
  ).toEqual([{ type: "context_usage_changed", usage: { tokens: 30_500, tokenWindow: 1_000_000 } }]);
});

test("compaction leaves the context unknown until a request reports it", () => {
  const project = createClaudeProjector("test");
  const reply = (input_tokens: number) =>
    native({
      type: "assistant",
      message: {
        id: `reply-${input_tokens}`,
        model: "claude-sonnet-5",
        content: [],
        usage: { input_tokens, output_tokens: 255 },
      },
      parent_tool_use_id: null,
    });
  const result = native({
    type: "result",
    subtype: "success",
    is_error: false,
    modelUsage: { "claude-sonnet-5": { contextWindow: 1_000_000 } },
  });
  project(reply(18_000));
  project(
    native({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "manual", pre_tokens: 18_255, post_tokens: 1_787 },
    }),
  );
  expect(project(result)).toEqual([]);

  project(reply(16_000));
  expect(project(result)).toEqual([
    { type: "context_usage_changed", usage: { tokens: 16_255, tokenWindow: 1_000_000 } },
  ]);
});

test("a turn that ends in an API error fails with it once, live and in history", () => {
  const limit = "You've hit your session limit · resets 11:50am (America/Los_Angeles)";
  const failure = synthetic(limit, "rate_limit");
  const live = replay([
    prompt,
    failure,
    native({ type: "result", subtype: "success", is_error: true, result: limit }),
    native({ type: "system", subtype: "session_state_changed", state: "idle" }),
  ]);
  const history = replay(asLiveStream([prompt, failure]));

  for (const state of [live, history])
    expect(state.messages).toEqual([
      { role: "user", content: "Say hi", rewindable: false },
      { role: "assistant", content: "", error: limit },
    ]);
});

test("a recoverable API error neither fails nor interrupts its turn", () => {
  const removed = synthetic(
    "API Error: an image in the conversation could not be processed and was removed.",
    "invalid_request",
  );
  const reply = assistant([{ type: "text", text: "Your screenshot was too large." }]);
  const live = replay([
    prompt,
    removed,
    reply,
    native({ type: "result", subtype: "success", is_error: false }),
    native({ type: "system", subtype: "session_state_changed", state: "idle" }),
  ]);
  const history = replay(asLiveStream([prompt, removed, reply]));

  for (const state of [live, history])
    expect(state.messages).toEqual([
      { role: "user", content: "Say hi", rewindable: false },
      { role: "assistant", messageId: "reply", content: "Your screenshot was too large." },
    ]);
});

test("CLI-authored messages are neither output nor a model change, unlike real model switches", () => {
  const reply = (model: string, reasoningEffort: string) =>
    native({
      type: "assistant",
      message: { id: model, model, content: [{ type: "text", text: "Done." }] },
      parent_tool_use_id: null,
      effort: reasoningEffort,
    });
  const notice = synthetic("No response requested.");
  const noticed = replay([reply("claude-a", "high"), notice]);
  const switched = replay([reply("claude-a", "high"), notice, reply("claude-b", "low")]);

  expect(noticed.messages).toEqual([
    { role: "assistant", messageId: "claude-a", content: "Done." },
  ]);
  expect(noticed.model).toEqual({ provider: "claude", name: "claude-a", reasoningEffort: "high" });
  expect(switched.model).toEqual({ provider: "claude", name: "claude-b", reasoningEffort: "low" });
});

test("models project once per transition, and each live turn's init restates the model", () => {
  const reply = (model: string, fields: object = {}) =>
    native({
      type: "assistant",
      message: { id: model, model, content: [] },
      parent_tool_use_id: null,
      ...fields,
    });
  const init = (model: string) => native({ type: "system", subtype: "init", model });
  const changes = (messages: SDKMessage[]) =>
    messages
      .flatMap(createClaudeProjector("test"))
      .flatMap((event) =>
        event.type === "model_changed"
          ? [
              [event.parentToolCallId ?? "main", event.model.name, event.model.reasoningEffort]
                .filter(Boolean)
                .join(" "),
            ]
          : [],
      );
  const child = { parent_tool_use_id: "child" };

  expect(
    changes([
      init("a"),
      reply("a"),
      reply("a", child),
      reply("a"),
      reply("a", child),
      reply("b"),
      init("a"),
    ]),
  ).toEqual(["main a", "child a", "main b", "main a"]);
  expect(changes(["high", "high", "low"].map((effort) => reply("a", { effort })))).toEqual([
    "main a high",
    "main a low",
  ]);
});

test.each(["[Request interrupted by user]", "[Request interrupted by user for tool use]"])(
  "replay hides the native interruption notice %s without hiding user input",
  (text) => {
    const notice = {
      type: "user",
      message: { content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    };
    const messages = [
      notice,
      { ...notice, origin: { kind: "human" } },
      { ...notice, message: { content: [{ type: "text", text: `What does ${text} mean?` }] } },
    ];
    const state = messages
      .map(native)
      .flatMap(createClaudeProjector("test"))
      .reduce(applySessionEvent, createInitialSessionState());
    expect(state.messages.map((message) => message.content)).toEqual([
      text,
      `What does ${text} mean?`,
    ]);
  },
);

test("typed commands show without their output, and model switches leave no command, live and in history", () => {
  const cli = (content: string) =>
    native({ type: "user", message: { role: "user", content }, parent_tool_use_id: null });
  const command = (name: string, args = "") =>
    `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`;
  const switched = cli(
    "<local-command-stdout>Set model to `claude-sonnet-5-5`</local-command-stdout>",
  );
  // A typed `/cost` replays as `/usage`. A model switch sends only its output live, while native
  // history also records it as a `/model` command.
  const live = replay([cli(command("usage")), switched, prompt]);
  const history = replay(
    asLiveStream([
      cli(command("usage")),
      cli(command("model", "claude-sonnet-5-5")),
      switched,
      prompt,
    ]),
  );

  for (const state of [live, history])
    expect(state.messages).toEqual([
      { role: "user", content: "/usage", rewindable: false },
      { role: "user", content: "Say hi", rewindable: false },
    ]);
});

test("native tool results replay edits, a completed checklist, and an answered question", async () => {
  const messages = (await Bun.file(new URL("./transcript.fixture.jsonl", import.meta.url)).text())
    .trim()
    .split("\n")
    .map((line) => native(JSON.parse(line)));
  const project = createClaudeProjector("toy-box-test");
  const state = messages.flatMap(project).reduce(applySessionEvent, createInitialSessionState());
  const calls = state.messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );
  expect(state.todos).toEqual([{ id: "1", title: "Verify the probe", status: "done" }]);
  expect(calls.find((call) => call.question)?.question).toMatchObject({
    question: "Do you want Red or Blue?",
    choices: ["Red", "Blue"],
    answer: "Red",
  });
  const diffs = calls.flatMap((call) => getToolCallFileDiffs(call) ?? []);
  expect(computeFileDiffStats(diffs).total).toEqual({ added: 3, removed: 1 });
  expect(diffs[1]?.hunks[0]?.lines).toContainEqual({ type: "removed", text: "alpha" });
  expect(diffs[1]?.hunks[0]?.lines).toContainEqual({ type: "added", text: "gamma" });
  expect(calls.find((call) => call.name === "finish")?.result).toMatchObject({
    success: true,
    content: "FINISHED",
  });
  expect(calls.some((call) => ["ToolSearch", "TaskCreate", "TaskUpdate"].includes(call.name))).toBe(
    false,
  );
});

test("streaming and committed text blocks converge on one assistant message", () => {
  const committed = [
    assistant([{ type: "text", text: "Hello " }]),
    assistant([{ type: "text", text: "world" }]),
  ];
  const stream = [
    native({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_start", message: { id: "reply" } },
    }),
    native({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
    }),
    committed[0]!,
    native({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
    }),
    committed[1]!,
  ];
  const reduce = (messages: SDKMessage[]) =>
    messages
      .flatMap(createClaudeProjector("test"))
      .reduce(applySessionEvent, createInitialSessionState()).messages;
  expect(reduce(stream)).toEqual(reduce(committed));
  expect(reduce(stream)).toHaveLength(1);
  expect(reduce(stream)[0]?.content).toBe("Hello world");
});

test("thinking summaries survive token progress and start fresh for the next block", () => {
  const project = createClaudeProjector("test");
  let state = createInitialSessionState();
  const receive = (message: SDKMessage) => {
    state = project(message).reduce(applySessionEvent, state);
  };
  const stream = (event: unknown) => native({ type: "stream_event", event });
  const start = stream({
    type: "content_block_start",
    content_block: { type: "thinking", thinking: "" },
  });
  const delta = stream({
    type: "content_block_delta",
    delta: { type: "thinking_delta", thinking: "ha" },
  });
  const committed = assistant([{ type: "thinking", thinking: "haha" }]);
  const progress = native({ type: "system", subtype: "thinking_tokens", estimated_tokens: 2 });

  receive(start);
  expect(state.status).toBe("reasoning");
  receive(delta);
  receive(progress);
  receive(delta);
  receive(progress);
  expect(state.reasoningContent).toBe("haha");
  receive(committed);
  expect(state).toEqual(
    createClaudeProjector("test")(committed).reduce(applySessionEvent, createInitialSessionState()),
  );
  receive(start);
  expect(state.reasoningContent).toBe("");
  receive(delta);
  expect(state.reasoningContent).toBe("ha");
});

test("background history retains the launch result and nested child activity", () => {
  const messages = [
    assistant([
      {
        type: "tool_use",
        id: "child",
        name: "Agent",
        input: { prompt: "Inspect", subagent_type: "Explore" },
      },
    ]),
    assistant(
      [{ type: "tool_use", id: "read", name: "Read", input: { file_path: "/project/file.ts" } }],
      "child-reply",
      "child",
    ),
    native({
      type: "user",
      parent_tool_use_id: "child",
      message: { content: [{ type: "tool_result", tool_use_id: "read", content: "hello" }] },
    }),
    assistant([{ type: "text", text: "Inspected." }], "child-reply", "child"),
    native({
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "child", content: "Launched" }] },
      tool_use_result: { status: "async_launched", agentId: "agent" },
    }),
    native({
      type: "user",
      origin: { kind: "task-notification" },
      message: { content: "Internal background task notification" },
    }),
  ];
  const state = messages
    .flatMap(createClaudeProjector("test"))
    .reduce(applySessionEvent, createInitialSessionState());
  const root = state.messages.find((message) => message.role === "assistant");
  expect(root?.toolCalls?.[0]).toMatchObject({
    name: "agent",
    // The main thread's agents run in the background unless the call says otherwise.
    arguments: { agent_type: "Explore", mode: "background" },
    result: { success: true, content: "Launched" },
    subagent: {
      content: "Inspected.",
      toolCalls: [{ name: "read", result: { success: true, content: "hello" } }],
    },
  });
  expect(state.messages).toHaveLength(1);
});

test("agents default to the background from the main thread and the foreground from a subagent", () => {
  const agent = (id: string, input: object, parent: string | null = null) =>
    assistant([{ type: "tool_use", id, name: "Agent", input }], id, parent);
  const state = replay([
    agent("main", {}),
    agent("main-sync", { run_in_background: false }),
    agent("nested", {}, "main"),
    agent("nested-background", { run_in_background: true }, "main"),
  ]);
  const [main, mainSync] = state.messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );
  expect(
    [main, mainSync, ...(main?.subagent?.toolCalls ?? [])].map((call) => call?.arguments.mode),
  ).toEqual(["background", "sync", "sync", "background"]);
});

test("a fork's history drops the context it inherited, as the live stream does", () => {
  const call = {
    type: "tool_use",
    id: "fork",
    name: "Agent",
    input: { subagent_type: "fork", prompt: "Recall the word" },
  };
  const fork = assistant([call]);
  const launched = native({
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: "fork", content: "Launched" }] },
    tool_use_result: { status: "async_launched" },
  });
  const output = assistant([{ type: "text", text: "ZEBRA" }], "fork-reply", "fork");
  const started = native({
    type: "system",
    subtype: "task_started",
    tool_use_id: "fork",
    is_backgrounded: true,
  });
  // A fork's transcript opens with the parent message that forked it and the fork's directive.
  const inherited = [
    assistant([{ type: "text", text: "Forking now." }, call], "reply", "fork"),
    native({
      type: "user",
      parent_tool_use_id: "fork",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "fork", content: "Fork started" },
          { type: "text", text: "<fork-boilerplate>Recall the word</fork-boilerplate>" },
        ],
      },
    }),
  ];
  const subagent = (state: ReturnType<typeof replay>) =>
    state.messages.find((message) => message.role === "assistant")?.toolCalls?.[0]?.subagent;
  const live = subagent(replay([fork, started, launched, output]));
  const history = subagent(replay(asLiveStream([fork, launched], [[...inherited, output]])));

  expect(history).toEqual(live);
  expect(history).toMatchObject({ content: "ZEBRA" });
  expect(history?.toolCalls).toBeUndefined();
});

test.each(["completed", "failed", "stopped"] as const)(
  "a background agent stays running until its native %s notification",
  (status) => {
    const project = createClaudeProjector("test");
    let state = createInitialSessionState({ status: "thinking" });
    const receive = (message: unknown) => {
      state = project(native(message)).reduce(applySessionEvent, state);
    };
    receive(
      assistant([
        { type: "tool_use", id: "child", name: "Agent", input: { run_in_background: true } },
      ]),
    );
    receive({
      type: "system",
      subtype: "task_started",
      task_id: "agent",
      tool_use_id: "child",
      is_backgrounded: true,
    });
    receive({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "child", content: "Launched" }] },
      tool_use_result: { status: "async_launched", agentId: "agent" },
    });
    receive(assistant([{ type: "text", text: "Child output" }], "child-reply", "child"));
    const agent = () =>
      state.messages.find((message) => message.role === "assistant")?.toolCalls?.[0];
    expect(agent()?.result).toBeUndefined();
    expect(agent()?.subagent?.content).toBe("Child output");

    receive({
      type: "system",
      subtype: "task_notification",
      task_id: "agent",
      tool_use_id: "child",
      status,
      summary: "Task outcome",
    });
    expect(agent()?.result).toMatchObject({
      success: status === "completed",
      content: "Task outcome",
    });
    expect(state.status).not.toBe("idle");
  },
);

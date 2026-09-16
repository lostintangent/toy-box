import { expect, test } from "bun:test";
import { join } from "node:path";
import { sessionArtifactsDirectory } from "@sessions/server/artifacts";
import { applySessionEvent, createInitialSession } from "@sessions/model/reducer";
import { computeFileDiffStats, getToolCallFileDiffs } from "@sessions/model/fileDiffs";
import type { SessionEvent } from "@sessions/model";
import { createCodexProjector } from "./projector";
import type { CommandAction, FileUpdateChange, ThreadItem } from "./protocol";
import type { RpcNotification } from "./protocol/transport";

function itemEvent(item: ThreadItem, method = "item/completed"): RpcNotification {
  return { method, params: { threadId: "native", turnId: "turn", item } };
}

test("native Toy Box tools keep their friendly identity and result live and after replay", () => {
  const item: ThreadItem = {
    type: "dynamicToolCall",
    id: "call-title",
    namespace: "toy_box",
    tool: "update_session_title",
    arguments: { title: "Native tools" },
    status: "completed",
    success: true,
    durationMs: null,
    contentItems: [{ type: "inputText", text: "Updated" }],
  };
  const live = createCodexProjector("native-tools");
  const events = [
    ...live(
      itemEvent(
        { ...item, status: "inProgress", success: null, contentItems: null },
        "item/started",
      ),
    ),
    ...live(itemEvent(item)),
  ];
  const replay = createCodexProjector("native-tools")(itemEvent(item));
  expect(events.reduce(applySessionEvent, createInitialSession())).toEqual(
    replay.reduce(applySessionEvent, createInitialSession()),
  );
  expect(events).toMatchObject([
    { type: "tool_start", toolName: "update_session_title", arguments: item.arguments },
    { type: "tool_end", success: true, result: "Updated" },
  ]);
  expect(
    createCodexProjector("external-tools")(
      itemEvent({ ...item, namespace: "another_app" }, "item/started"),
    ),
  ).toMatchObject([{ type: "tool_start", toolName: "another_app/update_session_title" }]);
});
const commandItem = (
  actions: CommandAction[],
): Extract<ThreadItem, { type: "commandExecution" }> => ({
  type: "commandExecution",
  id: "command",
  pluginId: null,
  scriptPath: null,
  command: actions.map((action) => action.command).join("; ") || "pwd",
  cwd: "/workspace",
  processId: null,
  source: "agent",
  status: "completed",
  commandActions: actions,
  aggregatedOutput: "Complete command output\n",
  exitCode: 0,
  durationMs: 25,
});

test.each<{ actions: CommandAction[]; description: string }>([
  {
    actions: [
      { type: "read", command: "cat /skills/SKILL.md", name: "SKILL.md", path: "/skills/SKILL.md" },
    ],
    description: "Read SKILL.md",
  },
  {
    actions: [{ type: "listFiles", command: "ls artifacts", path: "artifacts" }],
    description: "List artifacts",
  },
  {
    actions: [{ type: "search", command: "rg needle src", query: "needle", path: "src" }],
    description: "Search for needle in src",
  },
  {
    actions: [{ type: "search", command: "rg --files", query: null, path: null }],
    description: "Search files",
  },
  {
    actions: [
      { type: "listFiles", command: "ls", path: null },
      { type: "unknown", command: "pwd" },
    ],
    description: "List files; Run pwd",
  },
  {
    actions: [{ type: "unknown", command: "\n  node <<'NODE'\nconsole.log('hello');\nNODE" }],
    description: "Run node <<'NODE'",
  },
  { actions: [], description: "Run pwd" },
])("native command actions describe the tool: $description", ({ actions, description }) => {
  expect(
    createCodexProjector("command-labels")(itemEvent(commandItem(actions), "item/started")),
  ).toMatchObject([{ type: "tool_start", arguments: { description } }]);
});

test("full commands and output survive live projection and history replay", () => {
  const item = commandItem([
    { type: "unknown", command: "node <<'NODE'\nconsole.log('hello');\nNODE" },
  ]);
  const live = createCodexProjector("command-details");
  const events = [
    ...live(
      itemEvent(
        { ...item, status: "inProgress", aggregatedOutput: null, exitCode: null },
        "item/started",
      ),
    ),
    ...live(itemEvent(item)),
  ];
  const replay = createCodexProjector("command-details")(itemEvent(item));
  const reduce = (events: SessionEvent[]) =>
    events.reduce(applySessionEvent, createInitialSession());
  expect(reduce(events)).toEqual(reduce(replay));
  expect(events).toMatchObject([
    { type: "tool_start", toolName: "bash", arguments: { command: item.command } },
    { type: "tool_end", success: true, result: item.aggregatedOutput },
  ]);
});

const updates: FileUpdateChange[] = [
  { path: "/tmp/new.txt", kind: { type: "add" }, diff: "first\nsecond\n" },
  { path: "/tmp/old.txt", kind: { type: "delete" }, diff: "removed\n" },
  {
    path: "/tmp/updated.txt",
    kind: { type: "update", move_path: null },
    diff: "@@ -1,2 +1,2 @@\n-before\n+after\n retained\n",
  },
];

test("native additions, deletions, and edits use the shared diff statistics live and after replay", () => {
  const item: ThreadItem = {
    type: "fileChange",
    id: "patch",
    changes: updates,
    status: "completed",
  };
  const live = createCodexProjector("diff-test");
  const events = [
    ...live(itemEvent({ ...item, status: "inProgress" }, "item/started")),
    ...live(itemEvent(item)),
  ];
  const replay = createCodexProjector("diff-test")(itemEvent(item));
  const reduce = (events: SessionEvent[]) =>
    events.reduce(applySessionEvent, createInitialSession());
  const state = reduce(events);
  expect(state).toEqual(reduce(replay));
  const tool = state.messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  )[0]!;
  const diff = computeFileDiffStats(getToolCallFileDiffs(tool)!);
  expect(diff.total).toEqual({ added: 3, removed: 2 });
  expect(diff.byFile).toEqual([
    { path: "/tmp/new.txt", diff: { added: 2, removed: 0 } },
    { path: "/tmp/old.txt", diff: { added: 0, removed: 1 } },
    { path: "/tmp/updated.txt", diff: { added: 1, removed: 1 } },
  ]);
  const failed = createCodexProjector("diff-test")(itemEvent({ ...item, status: "failed" }));
  expect(failed.find((event) => event.type === "tool_end")).toMatchObject({ success: false });
});

test("native artifact renames leave membership to filesystem observation", () => {
  const sessionId = "artifact-projection";
  const root = sessionArtifactsDirectory(sessionId);
  const state = createCodexProjector(sessionId)(
    itemEvent({
      type: "fileChange",
      id: "rename",
      status: "completed",
      changes: [
        {
          path: join(root, "before.md"),
          kind: { type: "update", move_path: join(root, "after.md") },
          diff: "@@ -1 +1 @@\n-before\n+after\n",
        },
      ],
    }),
  ).reduce(applySessionEvent, createInitialSession({ artifacts: ["before.md"] }));
  expect(state.artifacts).toEqual(["before.md"]);
  expect(state.messages).toEqual([]);
});

test("native plan updates replace and clear shared todos", () => {
  const project = createCodexProjector("plans");
  const initial = project({
    method: "turn/plan/updated",
    params: {
      plan: [
        { step: "First", status: "pending" },
        { step: "Second", status: "inProgress" },
        { step: "Third", status: "completed" },
      ],
    },
  }).reduce(applySessionEvent, createInitialSession());
  expect(initial.todos?.map((todo) => todo.status)).toEqual(["pending", "in_progress", "done"]);
  const resumed = createCodexProjector("plans");
  const next = resumed({
    method: "turn/plan/updated",
    params: { plan: [{ step: "Replacement", status: "completed" }] },
  }).reduce(applySessionEvent, initial);
  expect(next.todos).toEqual([{ id: "codex-plan-0", title: "Replacement", status: "done" }]);
  expect(
    resumed({ method: "turn/plan/updated", params: { plan: [] } }).reduce(applySessionEvent, next)
      .todos,
  ).toBeUndefined();
  expect(initial.todos).toHaveLength(3);
});

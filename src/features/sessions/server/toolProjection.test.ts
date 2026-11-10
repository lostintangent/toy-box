import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { createToolCallProjector } from "./toolProjection";
import { createInitialSessionState, applySessionEvent } from "../model/reducer";
import type { SessionEvent, ToolCall } from "../model";

type ToolEnd = Extract<SessionEvent, { type: "tool_end" }>;

const sessionId = "owner";
const sessions = `${homedir()}/.toy-box/sessions`;
const artifacts = `${sessions}/${sessionId}/artifacts`;

function lifecycle(
  toolName: string,
  args: ToolCall["arguments"] = {},
  end: Partial<ToolEnd> = {},
): SessionEvent[] {
  return [
    { type: "tool_start", toolName, toolCallId: "call-1", arguments: args },
    { type: "tool_end", toolCallId: "call-1", success: true, ...end },
  ];
}

// A whole call's lifecycle through a fresh projector.
function call(toolName: string, args?: ToolCall["arguments"], end?: Partial<ToolEnd>) {
  return lifecycle(toolName, args, end).flatMap(createToolCallProjector(sessionId));
}

function project(name: string, result: unknown, success = true): SessionEvent[] {
  return call(name, {}, { success, result: JSON.stringify(result) });
}

function patch(...lines: string[]) {
  return { patch: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") };
}

function expectVisible(toolName: string, args?: ToolCall["arguments"]) {
  expect(call(toolName, args)).toEqual(lifecycle(toolName, args));
}

test("Toy Box bookkeeping tools are always omitted", () => {
  for (const name of [
    "check_session_status",
    "wait_for_sessions",
    "deliver_message",
    "send_to_inbox",
    "list_automations",
    "create_automation",
    "update_automation",
    "run_automation",
  ]) {
    expect(call(name)).toEqual([]);
  }
});

test("spawn_worker stays a visible tool call", () => {
  expectVisible("spawn_worker", { task: "Review the auth flow" });
});

test.each([
  [
    "omits this session's artifacts",
    { path: `~/.toy-box/sessions/${sessionId}/artifacts/a.md` },
    true,
  ],
  ["omits this session's artifacts by filePath", { filePath: `${artifacts}/a.md` }, true],
  [
    "shows another session's artifacts",
    { path: "~/.toy-box/sessions/other/artifacts/a.md" },
    false,
  ],
  ["shows root session state", { path: `~/.toy-box/sessions/${sessionId}/a.md` }, false],
  ["shows files outside session state", { path: "/tmp/a.md" }, false],
])("read, create, and edit %s", (_, args, omitted) => {
  for (const name of ["read", "create", "edit"]) {
    if (omitted) expect(call(name, args)).toEqual([]);
    else expectVisible(name, args);
  }
});

test.each([
  ["an artifact addition", patch(`*** Add File: ${artifacts}/plan.md`, "+# Plan"), true],
  ["an artifact of any type", patch(`*** Add File: ${artifacts}/run.sh`, "+bun test"), true],
  [
    "a home-relative artifact",
    patch(`*** Add File: .toy-box/sessions/${sessionId}/artifacts/plan.html`, "<!doctype html>"),
    true,
  ],
  ["an artifact deletion", patch(`*** Delete File: ${artifacts}/plan.md`), true],
  [
    "an artifact conversion",
    patch(
      `*** Add File: ${artifacts}/plan.html`,
      "<!doctype html>",
      `*** Delete File: ${artifacts}/plan.md`,
    ),
    true,
  ],
  ["root session state", patch(`*** Add File: ${sessions}/${sessionId}/plan.md`, "+# Plan"), false],
  [
    "another session's artifact",
    patch(`*** Add File: ${sessions}/other/artifacts/plan.md`, "+# Plan"),
    false,
  ],
  [
    "artifacts mixed with other files",
    patch(`*** Add File: ${artifacts}/plan.md`, "+# Plan", "*** Update File: /repo/notes.md"),
    false,
  ],
  ["no files", { patch: "not a patch" }, false],
])("patch with %s", (_, args, omitted) => {
  if (omitted) expect(call("patch", args)).toEqual([]);
  else expectVisible("patch", args);
});

test.each([
  ["open_session", "linked_session_added"],
  ["close_session", "linked_session_removed"],
  ["delete_session", "linked_session_removed"],
] as const)("%s updates linked sessions as soon as it starts", (name, type) => {
  const project = createToolCallProjector(sessionId);
  const [start, end] = lifecycle(name, { sessionId: "linked" });
  expect(project(start!)).toEqual([{ type, sessionId: "linked" }]);
  expect(project(end!)).toEqual([]);
});

test("create_session links only sessions it opened successfully", () => {
  const created = { sessionId: "created", opened: true };
  expect(project("create_session", created)).toEqual([
    { type: "linked_session_added", sessionId: "created" },
  ]);
  expect(project("create_session", { ...created, opened: false })).toEqual([]);
  expect(project("create_session", created, false)).toEqual([]);
  expect(call("create_session", {}, { result: "not json" })).toEqual([]);
});

test.each([
  { path: "/repo/src/foo.ts", file: { kind: "machine", path: "/repo/src/foo.ts" } },
  { path: `${artifacts}/plan.md`, file: { kind: "session", sessionId, path: "plan.md" } },
])("open_file and close_file publish $file.kind files once they succeed", ({ path, file }) => {
  for (const [name, type] of [
    ["open_file", "file_opened"],
    ["close_file", "file_closed"],
  ] as const) {
    expect(call(name, { path })).toEqual([{ type, file }]);
    expect(call(name, { path }, { success: false })).toEqual([]);
  }
});

test("a subagent's open_file takes effect, keyed apart from its siblings' calls", () => {
  const path = "/repo/src/foo.ts";
  const subagentCall = (parentToolCallId: string, toolName: string, args = {}) =>
    lifecycle(toolName, args).map((event) => ({ ...event, parentToolCallId }) as SessionEvent);
  const [openStart, openEnd] = subagentCall("agent-1", "open_file", { path });
  const [bashStart, bashEnd] = subagentCall("agent-2", "bash");

  expect(
    [openStart!, bashStart!, bashEnd!, openEnd!].flatMap(createToolCallProjector(sessionId)),
  ).toEqual([bashStart, bashEnd, { type: "file_opened", file: { kind: "machine", path } }]);
});

test("a completion whose start was never seen passes through", () => {
  const [, end] = lifecycle("open_file", { path: "/repo/src/foo.ts" });
  expect(createToolCallProjector(sessionId)(end!)).toEqual([end]);
});

test("screen and URL publication reduce through one durable session preview contract", () => {
  const screen = project("set_session_preview", {
    preview: { kind: "screen", screenId: "window:1:2:3" },
  });
  const first = screen.reduce(applySessionEvent, createInitialSessionState());
  expect(first.preview).toEqual({ kind: "screen", screenId: "window:1:2:3" });
  const web = project("set_session_preview", {
    preview: { kind: "url", url: "http://localhost:4200" },
  });
  const changed = web.reduce(applySessionEvent, first);
  expect(changed.preview).toEqual({ kind: "url", url: "http://localhost:4200" });
  expect(first.preview).toEqual({ kind: "screen", screenId: "window:1:2:3" });
  expect(
    project("set_session_preview", { preview: null }).reduce(applySessionEvent, changed).preview,
  ).toBeUndefined();
  expect([...screen, ...web].reduce(applySessionEvent, createInitialSessionState())).toEqual(
    changed,
  );
});

test("failed or malformed tools never publish a runnable preview", () => {
  expect(
    project("set_session_preview", { preview: { kind: "screen", screenId: "x" } }, false),
  ).toEqual([]);
  expect(project("set_session_preview", { preview: { kind: "screen", screenId: "" } })).toEqual([]);
  expect(
    project("set_session_preview", { preview: { kind: "url", url: "javascript:alert(1)" } }),
  ).toEqual([]);
  expect(project("set_session_preview", { unrelated: true })).toEqual([]);
});

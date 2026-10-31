import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolveToolCallPolicy, type ToolCompletion } from "./toolProjection";
import { createInitialSessionState, applySessionEvent } from "../model/reducer";
import type { SessionEvent, ToolCall } from "../model";

const sessionId = "owner";
const sessions = `${homedir()}/.toy-box/sessions`;
const artifacts = `${sessions}/${sessionId}/artifacts`;
const omitted = { kind: "omitted" } as const;

function policy(name: string, args: ToolCall["arguments"] = {}) {
  return resolveToolCallPolicy(name, args, { sessionId });
}

function complete(name: string, args: ToolCall["arguments"], completion: ToolCompletion) {
  const resolved = policy(name, args);
  if (resolved?.kind !== "translated") throw new Error("Expected a translated tool result.");
  return resolved.projectOnComplete?.(completion) ?? [];
}

function project(name: string, result: unknown, success = true): SessionEvent[] {
  return complete(name, {}, { success, result: JSON.stringify(result) });
}

function patch(...lines: string[]) {
  return { patch: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") };
}

test("Toy Box bookkeeping tools are always omitted", () => {
  for (const name of [
    "skill",
    "read_agent",
    "write_agent",
    "list_agents",
    "check_session_status",
    "wait_for_sessions",
    "deliver_message",
    "send_to_inbox",
    "list_automations",
    "create_automation",
    "update_automation",
    "run_automation",
  ]) {
    expect(policy(name)).toEqual(omitted);
  }
});

test("spawn_worker stays a visible tool call", () => {
  expect(policy("spawn_worker", { task: "Review the auth flow" })).toBeUndefined();
});

test.each([
  [
    "omits this session's artifacts",
    { path: `~/.toy-box/sessions/${sessionId}/artifacts/a.md` },
    omitted,
  ],
  ["omits this session's artifacts by filePath", { filePath: `${artifacts}/a.md` }, omitted],
  [
    "shows another session's artifacts",
    { path: "~/.toy-box/sessions/other/artifacts/a.md" },
    undefined,
  ],
  ["shows root session state", { path: `~/.toy-box/sessions/${sessionId}/a.md` }, undefined],
  ["shows files outside session state", { path: "/tmp/a.md" }, undefined],
])("read, create, and edit %s", (_, args, expected) => {
  for (const name of ["read", "create", "edit"]) expect(policy(name, args)).toEqual(expected);
});

test.each([
  ["an artifact addition", patch(`*** Add File: ${artifacts}/plan.md`, "+# Plan"), omitted],
  ["an artifact of any type", patch(`*** Add File: ${artifacts}/run.sh`, "+bun test"), omitted],
  [
    "a home-relative artifact",
    patch(`*** Add File: .toy-box/sessions/${sessionId}/artifacts/plan.html`, "<!doctype html>"),
    omitted,
  ],
  ["an artifact deletion", patch(`*** Delete File: ${artifacts}/plan.md`), omitted],
  [
    "an artifact conversion",
    patch(
      `*** Add File: ${artifacts}/plan.html`,
      "<!doctype html>",
      `*** Delete File: ${artifacts}/plan.md`,
    ),
    omitted,
  ],
  [
    "root session state",
    patch(`*** Add File: ${sessions}/${sessionId}/plan.md`, "+# Plan"),
    undefined,
  ],
  [
    "another session's artifact",
    patch(`*** Add File: ${sessions}/other/artifacts/plan.md`, "+# Plan"),
    undefined,
  ],
  [
    "artifacts mixed with other files",
    patch(`*** Add File: ${artifacts}/plan.md`, "+# Plan", "*** Update File: /repo/notes.md"),
    undefined,
  ],
  ["no files", { patch: "not a patch" }, undefined],
])("patch with %s", (_, args, expected) => {
  expect(policy("patch", args)).toEqual(expected);
});

test.each([
  ["open_session", "linked_session_added"],
  ["close_session", "linked_session_removed"],
  ["delete_session", "linked_session_removed"],
] as const)("%s updates linked sessions as soon as it starts", (name, type) => {
  expect(policy(name, { sessionId: "linked" })).toEqual({
    kind: "translated",
    projectOnStart: [{ type, sessionId: "linked" }],
  });
});

test("create_session links only sessions it opened successfully", () => {
  const created = { sessionId: "created", opened: true };
  expect(project("create_session", created)).toEqual([
    { type: "linked_session_added", sessionId: "created" },
  ]);
  expect(project("create_session", { ...created, opened: false })).toEqual([]);
  expect(project("create_session", created, false)).toEqual([]);
  expect(complete("create_session", {}, { success: true, result: "not json" })).toEqual([]);
});

test.each([
  { path: "/repo/src/foo.ts", file: { kind: "machine", path: "/repo/src/foo.ts" } },
  { path: `${artifacts}/plan.md`, file: { kind: "session", sessionId, path: "plan.md" } },
])("open_file and close_file publish $file.kind files once they succeed", ({ path, file }) => {
  for (const [name, type] of [
    ["open_file", "file_opened"],
    ["close_file", "file_closed"],
  ] as const) {
    expect(complete(name, { path }, { success: true })).toEqual([{ type, file }]);
    expect(complete(name, { path }, { success: false })).toEqual([]);
  }
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

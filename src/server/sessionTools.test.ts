import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { getSessionTools } from "./sessionTools";
import type { SessionType } from "@sessions/model";

const BASE_TOOLS = [
  "create_worker_session",
  "delete_session",
  "check_session_status",
  "wait_for_sessions",
  "deliver_message",
  "list_automations",
  "create_automation",
  "update_automation",
  "run_automation",
  "list_apps",
  "get_app",
  "update_app",
];

function toolNames(sessionType: SessionType, appId?: string): string[] {
  return getSessionTools(sessionType, appId).map((tool) => tool.name);
}

describe("SDK tool catalog", () => {
  test("standard sessions expose interactive session and orchestration tools", () => {
    expect(toolNames("standard")).toEqual([
      ...BASE_TOOLS.slice(0, 2),
      "open_session",
      "close_session",
      "open_file",
      "close_file",
      "validate_artifact_app",
      ...BASE_TOOLS.slice(2),
    ]);
    expect(getSessionTools("standard").every((tool) => tool.defer === "never")).toBe(true);
  });

  test("create_worker_session accepts a delegated task and execution overrides", () => {
    const tool = getSessionTools("standard").find(
      (candidate) => candidate.name === "create_worker_session",
    );
    const parameters = tool?.parameters as ZodType | undefined;

    expect(
      parameters?.safeParse({
        task: "Review the runtime",
        name: "Runtime reviewer",
        model: { name: "gpt-5" },
        directory: "/workspace",
        useWorktree: true,
      }).success,
    ).toBe(true);
    expect(parameters?.safeParse({ prompt: "Review the runtime" }).success).toBe(false);
    expect(parameters?.safeParse({ task: "Review", name: "" }).success).toBe(false);
    expect(tool?.description).toContain("child worker session");
    expect(tool?.description).toContain("ephemeral children run headlessly");
  });

  test("interactive sessions can validate only current-session artifact apps", () => {
    for (const sessionType of ["standard", "hyper"] satisfies SessionType[]) {
      expect(toolNames(sessionType)).toContain("validate_artifact_app");
    }
    for (const sessionType of ["automation", "worker", "inbox"] satisfies SessionType[]) {
      expect(toolNames(sessionType)).not.toContain("validate_artifact_app");
    }

    const tool = getSessionTools("standard").find(
      (candidate) => candidate.name === "validate_artifact_app",
    );
    const parameters = tool?.parameters as ZodType | undefined;
    expect(parameters?.safeParse({ path: "release-board.toy" }).success).toBe(true);
    expect(parameters?.safeParse({ path: "release-board.tsx" }).success).toBe(false);
    expect(
      parameters?.safeParse({ path: "release-board.toy", sessionId: "other-session" }).success,
    ).toBe(false);
    expect(tool?.description).toContain("without registering or saving");
    expect(tool?.description?.length).toBeLessThan(120);
  });

  test("only hyper sessions can create independent top-level sessions", () => {
    expect(toolNames("standard")).not.toContain("create_session");

    const hyperTools = getSessionTools("hyper");
    const tool = hyperTools.find((candidate) => candidate.name === "create_session");
    const parameters = tool?.parameters as ZodType | undefined;

    expect(
      parameters?.safeParse({
        prompt: "Start a durable investigation",
        model: { name: "gpt-5" },
        directory: "/workspace",
        useWorktree: true,
        open: true,
      }).success,
    ).toBe(true);
    expect(parameters?.safeParse({ task: "Start a durable investigation" }).success).toBe(false);
    expect(tool?.description).toContain("independent top-level session");
    expect(tool?.description).toContain("only when explicitly supplied");
    expect(tool?.description).toContain("does not open");
    expect(tool?.description).toContain("defaults to false");
    expect(tool?.description).toContain("open_session");
    expect(toolNames("hyper")).toEqual([
      "create_session",
      ...toolNames("standard"),
      "update_settings",
      "register_editor",
      "list_app_definitions",
      "register_app",
      "install_app",
      "uninstall_app",
      "create_app",
      "delete_app",
    ]);
  });

  test("Hyper can manage TSX app definitions and save stateful instances", () => {
    const hyperTools = getSessionTools("hyper");
    const register = hyperTools.find((candidate) => candidate.name === "register_app");
    const install = hyperTools.find((candidate) => candidate.name === "install_app");
    const uninstall = hyperTools.find((candidate) => candidate.name === "uninstall_app");
    const listDefinitions = hyperTools.find(
      (candidate) => candidate.name === "list_app_definitions",
    );
    const list = hyperTools.find((candidate) => candidate.name === "list_apps");
    const get = hyperTools.find((candidate) => candidate.name === "get_app");
    const create = hyperTools.find((candidate) => candidate.name === "create_app");
    const update = hyperTools.find((candidate) => candidate.name === "update_app");
    const deleteApp = hyperTools.find((candidate) => candidate.name === "delete_app");
    const registerParameters = register?.parameters as ZodType | undefined;
    const installParameters = install?.parameters as ZodType | undefined;
    const uninstallParameters = uninstall?.parameters as ZodType | undefined;
    const listDefinitionsParameters = listDefinitions?.parameters as ZodType | undefined;
    const listParameters = list?.parameters as ZodType | undefined;
    const getParameters = get?.parameters as ZodType | undefined;
    const createParameters = create?.parameters as ZodType | undefined;
    const updateParameters = update?.parameters as ZodType | undefined;
    const deleteParameters = deleteApp?.parameters as ZodType | undefined;

    expect(registerParameters?.safeParse({ id: "release-board" }).success).toBe(true);
    expect(registerParameters?.safeParse({ id: "../release-board" }).success).toBe(false);
    expect(
      registerParameters?.safeParse({
        id: "release-board",
        tsx: "export default function App() { return <main />; }",
      }).success,
    ).toBe(false);
    expect(
      installParameters?.safeParse({
        url: "https://gist.github.com/octocat/aa5a315d61ae9438b18d",
      }).success,
    ).toBe(true);
    expect(
      installParameters?.safeParse({
        url: "https://gist.github.com/octocat/aa5a315d61ae9438b18d",
        id: "release-board",
      }).success,
    ).toBe(true);
    expect(installParameters?.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(uninstallParameters?.safeParse({ id: "release-board" }).success).toBe(true);
    expect(listDefinitionsParameters?.safeParse({}).success).toBe(true);
    expect(listDefinitionsParameters?.safeParse({ id: "release-board" }).success).toBe(false);
    expect(listParameters?.safeParse({}).success).toBe(true);
    expect(listParameters?.safeParse({ definitionId: "release-board" }).success).toBe(false);
    expect(getParameters?.safeParse({ appId: "toy-box-app-a" }).success).toBe(true);
    expect(getParameters?.safeParse({}).success).toBe(false);
    expect(
      createParameters?.safeParse({
        definitionId: "release-board",
        title: "v2 launch",
        state: { columns: ["queued", "shipped"], cards: [] },
      }).success,
    ).toBe(true);
    expect(
      createParameters?.safeParse({
        definitionId: "release-board",
        config: { columns: ["queued", "shipped"] },
      }).success,
    ).toBe(false);
    expect(
      updateParameters?.safeParse({
        appId: "toy-box-app-a",
        expectedRevision: 4,
        color: "#8b5cf6",
        state: { pattern: "\\d+", flags: "g", testText: "42" },
      }).success,
    ).toBe(true);
    expect(
      updateParameters?.safeParse({
        appId: "toy-box-app-a",
        expectedRevision: 4,
        color: "violet",
      }).success,
    ).toBe(false);
    expect(deleteParameters?.safeParse({ appId: "toy-box-app-a" }).success).toBe(true);
    expect(register?.description).toContain("manifest state contract");
    expect(register?.description).toContain("typechecks and compiles");
    expect(register?.description).toContain("~/.toy-box/apps/<id>/");
    expect(register?.description).not.toContain("useWorkspace(selector)");
    expect(install?.description).toContain("first saved instance");
    expect(uninstall?.description).toContain("saved instances");
    expect(listDefinitions?.description).toContain("installed Toy Box app definitions");
    for (const tool of [
      register,
      install,
      uninstall,
      listDefinitions,
      list,
      get,
      create,
      update,
      deleteApp,
    ]) {
      expect(tool?.description?.length).toBeLessThan(120);
    }
  });

  test("Hyper's editor tool defers the authoring contract to its skill", () => {
    const tool = getSessionTools("hyper").find((candidate) => candidate.name === "register_editor");

    expect(tool?.description).toContain("Registers or replaces a custom editor");
    expect(tool?.description).toContain("`create-toy-box-editor`");
    expect(tool?.description).not.toContain("Toybox.onRender");
    expect(tool?.description).not.toContain("Toybox.spawnWorker");
  });

  test("only automation and hyper sessions can update settings", () => {
    expect(toolNames("automation")).toEqual([...BASE_TOOLS, "update_settings"]);
    for (const sessionType of ["standard", "worker", "inbox"] satisfies SessionType[]) {
      expect(toolNames(sessionType)).not.toContain("update_settings");
    }

    const tool = getSessionTools("automation").find(
      (candidate) => candidate.name === "update_settings",
    );
    const parameters = tool?.parameters as ZodType | undefined;

    expect(
      parameters?.safeParse({ accentColor: "#FACC15", terminalShell: "/bin/fish" }).success,
    ).toBe(true);
    expect(parameters?.safeParse({ accentColor: "yellow" }).success).toBe(false);
  });

  test("every session can inspect and update apps while app-owned workers stay scoped", () => {
    expect(toolNames("worker")).toEqual(BASE_TOOLS);
    const standardTools = getSessionTools("standard");
    const genericGet = standardTools.find(({ name }) => name === "get_app");
    const genericUpdate = standardTools.find(({ name }) => name === "update_app");
    const genericGetParameters = genericGet?.parameters as ZodType | undefined;
    const genericUpdateParameters = genericUpdate?.parameters as ZodType | undefined;
    expect(genericGetParameters?.safeParse({ appId: "another-app" }).success).toBe(true);
    expect(genericGetParameters?.safeParse({}).success).toBe(false);
    expect(genericGet?.description).toContain("expectedRevision");
    expect(genericUpdate?.description).toContain("schema validation");
    expect(genericUpdate?.description).toContain("merge current state and retry");
    expect(
      genericUpdateParameters?.safeParse({
        appId: "another-app",
        expectedRevision: 2,
        state: { pattern: "\\d+" },
      }).success,
    ).toBe(true);

    const tools = getSessionTools("worker", "app");
    expect(tools.map(({ name }) => name)).toEqual(BASE_TOOLS);
    const getParameters = tools.at(-2)?.parameters as ZodType | undefined;
    const updateParameters = tools.at(-1)?.parameters as ZodType | undefined;
    expect(getParameters?.safeParse({}).success).toBe(true);
    expect(getParameters?.safeParse({ appId: "another-app" }).success).toBe(false);
    expect(
      updateParameters?.safeParse({ expectedRevision: 2, state: { pattern: "\\d+" } }).success,
    ).toBe(true);
    expect(
      updateParameters?.safeParse({
        appId: "another-app",
        expectedRevision: 2,
        state: { pattern: "\\d+" },
      }).success,
    ).toBe(false);
  });

  test("only Hyper can manage app definitions and instance lifecycles", () => {
    const lifecycleTools = [
      "list_app_definitions",
      "register_app",
      "install_app",
      "uninstall_app",
      "create_app",
      "delete_app",
    ];
    for (const sessionType of [
      "standard",
      "automation",
      "worker",
      "inbox",
    ] satisfies SessionType[]) {
      for (const tool of lifecycleTools) expect(toolNames(sessionType)).not.toContain(tool);
    }
    for (const tool of lifecycleTools) expect(toolNames("hyper")).toContain(tool);
  });

  test("inbox sessions add only their result tool to the headless catalog", () => {
    expect(toolNames("inbox")).toEqual([...BASE_TOOLS, "send_to_inbox"]);
  });
});

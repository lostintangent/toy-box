import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import type { SessionType } from "@sessions/model";
import { getSessionTools } from "./sessionTools";

describe("SDK tool catalog", () => {
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

  test("lets every session role validate its own artifact apps", () => {
    const sessionTypes = [
      "standard",
      "automation",
      "inbox",
      "hyper",
      "worker",
    ] satisfies SessionType[];
    for (const sessionType of sessionTypes) {
      const names = getSessionTools(sessionType).map(({ name }) => name);
      expect(names).toContain("validate_artifact_app");
      if (sessionType !== "hyper") {
        expect(names).not.toContain("register_app");
        expect(names).not.toContain("register_editor");
      }
    }

    const tool = getSessionTools("standard").find(({ name }) => name === "validate_artifact_app");
    const parameters = tool?.parameters as ZodType | undefined;
    expect(parameters?.safeParse({ path: "release-board.toy" }).success).toBe(true);
    expect(parameters?.safeParse({ path: "release-board.tsx" }).success).toBe(false);
    expect(
      parameters?.safeParse({ path: "release-board.toy", sessionId: "other-session" }).success,
    ).toBe(false);
    expect(tool?.description).toContain("without registering or saving");
    expect(tool?.description?.length).toBeLessThan(120);
  });

  test("validates independent top-level session inputs", () => {
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

  test("validates update-settings inputs", () => {
    const tool = getSessionTools("automation").find(
      (candidate) => candidate.name === "update_settings",
    );
    const parameters = tool?.parameters as ZodType | undefined;

    expect(
      parameters?.safeParse({ accentColor: "#FACC15", terminalShell: "/bin/fish" }).success,
    ).toBe(true);
    expect(parameters?.safeParse({ accentColor: "yellow" }).success).toBe(false);
  });

  test("validates generic and app-owned app operations", () => {
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
});

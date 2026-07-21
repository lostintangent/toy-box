import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { getSessionTools } from "./index";
import type { SessionType } from "@/types";

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
];

function toolNames(sessionType: SessionType): string[] {
  return getSessionTools(sessionType).map((tool) => tool.name);
}

describe("SDK tool catalog", () => {
  test("standard sessions expose interactive session and orchestration tools", () => {
    expect(toolNames("standard")).toEqual([
      ...BASE_TOOLS.slice(0, 2),
      "open_session",
      "close_session",
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
        model: { name: "gpt-5" },
        directory: "/workspace",
        useWorktree: true,
      }).success,
    ).toBe(true);
    expect(parameters?.safeParse({ prompt: "Review the runtime" }).success).toBe(false);
    expect(tool?.description).toContain("child worker session");
    expect(tool?.description).toContain("automatically opens");
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
      "register_artifact_kind",
    ]);
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

  test("worker sessions expose the shared headless catalog", () => {
    expect(toolNames("worker")).toEqual(BASE_TOOLS);
  });

  test("inbox sessions add only their result tool to the headless catalog", () => {
    expect(toolNames("inbox")).toEqual([...BASE_TOOLS, "send_to_inbox"]);
  });
});

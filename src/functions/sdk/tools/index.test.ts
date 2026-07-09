import { describe, expect, test } from "bun:test";
import { getSessionTools } from "./index";
import type { SessionType } from "@/types";

const BASE_TOOLS = [
  "create_session",
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
      "create_session",
      "delete_session",
      "open_session",
      "close_session",
      ...BASE_TOOLS.slice(2),
    ]);
    expect(getSessionTools("standard").every((tool) => tool.defer === "never")).toBe(true);
  });

  test("hyper sessions add the global artifact-kind tool", () => {
    expect(toolNames("hyper")).toEqual([...toolNames("standard"), "register_artifact_kind"]);
  });

  test("managed headless session types omit layout tools", () => {
    for (const sessionType of ["automation", "child"] satisfies SessionType[]) {
      expect(toolNames(sessionType)).toEqual(BASE_TOOLS);
    }
  });

  test("inbox sessions add only their result tool to the headless catalog", () => {
    expect(toolNames("inbox")).toEqual([...BASE_TOOLS, "send_to_inbox"]);
  });
});

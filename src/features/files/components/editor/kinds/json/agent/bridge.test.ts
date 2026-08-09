import { describe, expect, test } from "bun:test";
import type { Worker } from "@workers/model";
import { sessionFile } from "@files/model";
import { activePointersOf, buildAgentPrompt, targetMetadata } from "./bridge";

function worker(metadata: Worker["metadata"]): Worker {
  return {
    type: "file",
    sessionId: "s",
    ephemeral: true,
    file: sessionFile("src", "data.json"),
    metadata,
  };
}

describe("agent bridge", () => {
  test("collects the pointers of workers that target a location", () => {
    const pointers = activePointersOf([
      worker(targetMetadata("/user/name")),
      worker(undefined),
      worker({ pointer: 42 }),
    ]);

    expect([...pointers]).toEqual(["/user/name"]);
  });

  test("scopes the prompt to the target pointer and the instruction", () => {
    const prompt = buildAgentPrompt({
      pointer: "/user/roles",
      value: "[]",
      instruction: "add an admin role",
    });

    expect(prompt).toContain("/user/roles");
    expect(prompt).toContain("add an admin role");
  });

  test("allows additions within the selected location without classifying the request", () => {
    const prompt = buildAgentPrompt({
      pointer: "/users",
      value: "[]",
      instruction: "add an admin named Alice",
    });

    expect(prompt).toContain("including adding, replacing, or removing values");
    expect(prompt).toContain("add an admin named Alice");
  });

  test("bounds a very large value preview", () => {
    const prompt = buildAgentPrompt({
      pointer: "",
      value: "x".repeat(9_000),
      instruction: "trim it",
    });

    expect(prompt).toContain("truncated");
    expect(prompt.length).toBeLessThan(6_000);
  });
});

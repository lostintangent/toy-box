import { describe, expect, test } from "bun:test";
import type { ArtifactWorker } from "@/types";
import { activePointersOf, buildAgentPrompt, targetMetadata } from "./agent";

function worker(metadata: ArtifactWorker["metadata"]): ArtifactWorker {
  return { sessionId: "s", sourceSessionId: "src", path: "data.json", metadata };
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
      valueJson: "[]",
      instruction: "add an admin role",
    });

    expect(prompt).toContain("/user/roles");
    expect(prompt).toContain("add an admin role");
  });

  test("frames an add-intent prompt around inserting a new entry", () => {
    const prompt = buildAgentPrompt({
      pointer: "/users",
      valueJson: "[]",
      instruction: "an admin named Alice",
      intent: "add",
    });

    expect(prompt).toContain("Add a new entry");
    expect(prompt).toContain("an admin named Alice");
  });

  test("bounds a very large value preview", () => {
    const prompt = buildAgentPrompt({
      pointer: "",
      valueJson: "x".repeat(9_000),
      instruction: "trim it",
    });

    expect(prompt).toContain("truncated");
    expect(prompt.length).toBeLessThan(6_000);
  });
});

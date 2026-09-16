import { expect, test } from "bun:test";
import { sessionArtifactsDirectory } from "./artifacts";
import { buildSessionSystemPrompt } from "./instructions";

test("instructions identify session resources and preserve the initial subject and host policy", () => {
  const sessionId = "example-session";
  const model = { provider: "codex", name: "model", reasoningEffort: "high" };
  const content = buildSessionSystemPrompt(sessionId, {
    directory: "/workspace",
    model,
    artifactPath: "initial-diagram.svg",
    additionalInstructions: "Follow this role's contract.",
  });
  for (const expected of [
    sessionId,
    "/workspace",
    JSON.stringify(model),
    sessionArtifactsDirectory(sessionId),
    "initial-diagram.svg",
    "Follow this role's contract.",
  ])
    expect(content).toContain(expected);
});

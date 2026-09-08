import { describe, expect, test } from "bun:test";
import { buildSessionSystemPrompt } from "./client";

const DIRECTORY = "/workspace";
const MODEL = { name: "gpt-5", reasoningEffort: "high" as const };

function instructions(additionalInstructions?: string): string {
  return buildSessionSystemPrompt("example-session", {
    directory: DIRECTORY,
    model: MODEL,
    additionalInstructions,
  }).content;
}

describe("SDK Session system prompt", () => {
  test("describes universal Session resources", () => {
    const content = instructions();

    expect(content).toContain(`The user's current working directory is: ${DIRECTORY}`);
    expect(content).toContain(
      `This session is using model configuration: ${JSON.stringify(MODEL)}.`,
    );
    expect(content).toContain("This session's ID is: example-session");
    expect(content).toContain("This session's state folder is:");
    expect(content).toContain("This session's files folder is:");
  });

  test("omits model context when creation did not select one", () => {
    const content = buildSessionSystemPrompt("example-session", {
      directory: DIRECTORY,
    }).content;

    expect(content).not.toContain("model configuration");
  });

  test("describes the universal SVG protocol", () => {
    const content = instructions();

    expect(content).toContain("standard static SVG");
    expect(content).toContain('<g id="...">');
    expect(content).toContain("must not contain doctypes");
  });

  test("makes an artifact-first draft's file the subject of its initial discussion", () => {
    const content = buildSessionSystemPrompt("example-session", {
      directory: DIRECTORY,
      artifactPath: "diagram.svg",
    }).content;

    expect(content).toContain(
      "The draft began with the artifact `diagram.svg`, which is the center of the user's initial discussion.",
    );
    expect(instructions()).not.toContain("The draft began with the artifact");
  });

  test("appends application-supplied instructions", () => {
    expect(instructions("Role-specific contract.")).toContain("Role-specific contract.");
  });
});

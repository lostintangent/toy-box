import { describe, expect, test } from "bun:test";
import { buildSessionSystemMessage } from "./client";
import type { SessionType } from "@/types";

const DIRECTORY = "/workspace";
const MODEL = { name: "gpt-5", reasoningEffort: "high" as const };

function instructions(sessionType: SessionType): string {
  return buildSessionSystemMessage(`${sessionType}-session`, {
    directory: DIRECTORY,
    model: MODEL,
    sessionType,
  }).content;
}

describe("SDK session system message", () => {
  test("gives every session type the same working-directory context", () => {
    for (const sessionType of [
      "standard",
      "automation",
      "inbox",
      "hyper",
      "worker",
    ] satisfies SessionType[]) {
      expect(instructions(sessionType)).toContain(
        `The user's current working directory is: ${DIRECTORY}`,
      );
    }
  });

  test("gives every session type its creation model configuration", () => {
    for (const sessionType of [
      "standard",
      "automation",
      "inbox",
      "hyper",
      "worker",
    ] satisfies SessionType[]) {
      expect(instructions(sessionType)).toContain(
        `This session was created with model configuration: ${JSON.stringify(MODEL)}.`,
      );
    }
  });

  test("omits model context when creation did not select one", () => {
    const content = buildSessionSystemMessage("standard-session", {
      directory: DIRECTORY,
      sessionType: "standard",
    }).content;

    expect(content).not.toContain("model configuration");
  });

  test("gives every session type the notification protocol", () => {
    for (const sessionType of [
      "standard",
      "automation",
      "inbox",
      "hyper",
      "worker",
    ] satisfies SessionType[]) {
      const content = instructions(sessionType);
      expect(content).toContain("<toybox-notification>");
      expect(content).toContain("file_edited");
    }
  });

  test("teaches every session type the editable SVG drawing contract", () => {
    for (const sessionType of [
      "standard",
      "automation",
      "inbox",
      "hyper",
      "worker",
    ] satisfies SessionType[]) {
      const content = instructions(sessionType);
      expect(content).toContain("`.svg`");
      expect(content).toContain("standard static SVG");
      expect(content).toContain('<g id="...">');
      expect(content).toContain("theme-derived background and dot grid");
      expect(content).toContain("must not contain doctypes");
    }
  });

  test("gives session-file-backed types their artifact context", () => {
    for (const sessionType of [
      "standard",
      "automation",
      "hyper",
      "worker",
    ] satisfies SessionType[]) {
      const content = instructions(sessionType);
      expect(content).toContain(`This session's ID is: ${sessionType}-session`);
      expect(content).toContain("This session's state folder is:");
      expect(content).toContain("This session's files folder is:");
      expect(content).not.toContain("send_to_inbox");
    }
  });

  test("makes an artifact-first draft's file the subject of its initial discussion", () => {
    const content = buildSessionSystemMessage("standard-session", {
      directory: DIRECTORY,
      sessionType: "standard",
      artifactPath: "diagram.svg",
    }).content;

    expect(content).toContain(
      "The draft began with the artifact `diagram.svg`, which is the center of the user's initial discussion.",
    );
    expect(instructions("standard")).not.toContain("The draft began with the artifact");
  });

  test("adds automation purpose and feedback policy only to automation sessions", () => {
    const content = instructions("automation");

    expect(content).toContain("its session ID is also its automation ID");
    expect(content).toContain("Treat user edits to this run's artifacts as feedback");
    expect(instructions("standard")).not.toContain("automation ID");
  });

  test("gives inbox sessions their initial result contract", () => {
    const content = instructions("inbox");

    expect(content).toContain("background task managed by the Toy Box inbox");
    expect(content).toContain("MUST call `send_to_inbox` exactly once");
    expect(content).toContain("1 sentence");
    expect(content).toContain("include an `artifact`");
    expect(content).toContain("Only include an artifact when the request requires it");
    expect(content).toContain("do not call `send_to_inbox` again");
    expect(content).toContain("do not duplicate it with an inbox result");
    expect(content).toContain("its session ID is also its inbox entry ID");
    // Inbox artifacts are ordinary session files now, so inbox sessions get the common files instruction.
    expect(content).toContain(
      "This session's files folder is: ~/.copilot/session-state/inbox-session/files",
    );
    expect(content).toContain("write it under the files folder");
    expect(content).not.toContain("~/.toy-box/inbox");
    expect(content).toContain("file_edited");
  });
});

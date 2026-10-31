import { describe, expect, test } from "bun:test";
import { sessionFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { createScreenPane } from "@screens/model";
import type { SessionCanvas } from ".";
import {
  createCanvasPane,
  createLinkedPanes,
  createSessionPane,
  resolveArtifactSelection,
  resolveEditorAutoFocus,
} from "./panes";

describe("artifact selection", () => {
  const first = { path: "first.md", updatedAt: 1 };
  const latest = { path: "latest.md", updatedAt: 2 };
  const oldest = { path: "oldest.md", updatedAt: 0 };
  const artifacts = Object.freeze([first, latest, oldest]);

  test("opens the most recently updated artifact regardless of catalog order", () => {
    expect(resolveArtifactSelection(artifacts)?.path).toBe(latest.path);
  });

  test("retains the selected artifact over newer output", () => {
    expect(resolveArtifactSelection(artifacts, first.path)?.path).toBe(first.path);
  });

  test("prefers an artifact-first session's document until another artifact is selected", () => {
    expect(resolveArtifactSelection(artifacts, undefined, first.path)?.path).toBe(first.path);
    expect(resolveArtifactSelection(artifacts, latest.path, first.path)?.path).toBe(latest.path);
  });

  test("falls back when the selected or initial artifact disappears", () => {
    expect(resolveArtifactSelection(artifacts, "deleted.md", "deleted.md")?.path).toBe(latest.path);
    expect(resolveArtifactSelection(artifacts, "deleted.md", first.path)?.path).toBe(first.path);
    expect(resolveArtifactSelection([], first.path, first.path)).toBeUndefined();
  });
});

function canvas(overrides: Partial<SessionCanvas> = {}): SessionCanvas {
  return {
    key: JSON.stringify(["user:documint", "documint-markdown-agent", "review-plan"]),
    extensionId: "user:documint",
    canvasId: "documint-markdown-agent",
    instanceId: "review-plan",
    title: "Review Plan",
    url: "http://127.0.0.1:51460/?instanceId=review-plan",
    revision: 1,
    ...overrides,
  };
}

describe("linked panes", () => {
  test("links files first, then the screen preview, canvases, and child sessions", () => {
    const opened = sessionFile("B", "notes.md");

    expect(
      createLinkedPanes("A", ["child"], [canvas()], ["plan.md"], [opened], {
        kind: "screen",
        screenId: "window",
      }),
    ).toEqual([
      createEditorPane(sessionFile("A", "plan.md")),
      createEditorPane(opened),
      createScreenPane("window", "A"),
      createCanvasPane("A", canvas()),
      createSessionPane("child", true),
    ]);
  });
});

describe("artifact auto-focus", () => {
  const automationSessionId = "22222222-2222-4222-8222-222222222222";
  const chatPane = createSessionPane(automationSessionId);
  const artifactPane = createEditorPane(sessionFile(automationSessionId, "report.md"));
  const regularChatPane = createSessionPane("session-1");
  const regularEditorPane = createEditorPane(sessionFile("session-1", "notes.md"));

  test("always scope focuses session and automation artifact panes", () => {
    expect(
      resolveEditorAutoFocus(new Set([chatPane.id]), [chatPane, artifactPane], "always").focusPane,
    ).toEqual(artifactPane);

    expect(
      resolveEditorAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularEditorPane],
        "always",
      ).focusPane,
    ).toEqual(regularEditorPane);
  });

  test("automations scope focuses automation artifacts only", () => {
    const { focusPane, seenPaneIds } = resolveEditorAutoFocus(
      new Set([chatPane.id]),
      [chatPane, artifactPane],
      "automations",
      [automationSessionId],
    );

    expect(focusPane).toEqual(artifactPane);
    expect(seenPaneIds).toEqual(new Set([chatPane.id, artifactPane.id]));

    expect(
      resolveEditorAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularEditorPane],
        "automations",
        [automationSessionId],
      ).focusPane,
    ).toBeUndefined();
  });

  test("sessions scope focuses regular session artifacts only", () => {
    expect(
      resolveEditorAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularEditorPane],
        "sessions",
        [automationSessionId],
      ).focusPane,
    ).toEqual(regularEditorPane);

    expect(
      resolveEditorAutoFocus(new Set([chatPane.id]), [chatPane, artifactPane], "sessions", [
        automationSessionId,
      ]).focusPane,
    ).toBeUndefined();
  });

  test("never scope does not focus artifacts", () => {
    expect(
      resolveEditorAutoFocus(new Set([chatPane.id]), [chatPane, artifactPane], "never").focusPane,
    ).toBeUndefined();

    expect(
      resolveEditorAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularEditorPane],
        "never",
      ).focusPane,
    ).toBeUndefined();
  });

  test("an artifact-first draft focuses its artifact independently of the preference", () => {
    expect(
      resolveEditorAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularEditorPane],
        "never",
        [],
        new Set([regularEditorPane.id]),
      ).focusPane,
    ).toEqual(regularEditorPane);
  });

  test("focuses a pane at most once per appearance", () => {
    const first = resolveEditorAutoFocus(
      new Set([chatPane.id]),
      [chatPane, artifactPane],
      "always",
    );

    expect(
      resolveEditorAutoFocus(first.seenPaneIds, [chatPane, artifactPane], "always").focusPane,
    ).toBeUndefined();
  });

  test("ignores newly appearing session and canvas panes", () => {
    expect(
      resolveEditorAutoFocus(
        new Set(),
        [chatPane, createCanvasPane(automationSessionId, canvas())],
        "always",
      ).focusPane,
    ).toBeUndefined();
  });

  test("does not claim focus in multi-session layouts, but still marks panes seen", () => {
    const multi = resolveEditorAutoFocus(
      new Set(),
      [chatPane, createSessionPane("session-2"), artifactPane],
      "always",
    );
    expect(multi.focusPane).toBeUndefined();

    // Back to a single-session layout: the artifact was already seen, so it
    // does not retroactively grab focus.
    expect(
      resolveEditorAutoFocus(multi.seenPaneIds, [chatPane, artifactPane], "always").focusPane,
    ).toBeUndefined();
  });

  test("prunes departed panes so a reopened source can focus its artifact again", () => {
    const opened = resolveEditorAutoFocus(new Set(), [chatPane, artifactPane], "always");
    expect(opened.focusPane).toEqual(artifactPane);

    // Closing the source clears its panes and re-arms the trigger.
    const closed = resolveEditorAutoFocus(opened.seenPaneIds, [], "always");
    expect(closed.seenPaneIds).toEqual(new Set());

    expect(
      resolveEditorAutoFocus(closed.seenPaneIds, [chatPane, artifactPane], "always").focusPane,
    ).toEqual(artifactPane);
  });
});

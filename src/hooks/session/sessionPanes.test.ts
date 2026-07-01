import { describe, expect, test } from "bun:test";
import {
  createArtifactPane,
  createCanvasPaneId,
  createLinkedCanvasPane,
  createLinkedPanes,
  createLinkedSessionPane,
  deriveOpenSessionIds,
  createSessionPane,
  deriveVisibleSessionGridPanes,
  resolveArtifactAutoFocus,
  type SessionGridPane,
} from "@/hooks/session/sessionPanes";
import type { SessionCanvas } from "@/types";

function selectedSessionPane(sessionId: string): Extract<SessionGridPane, { kind: "session" }> {
  return createSessionPane(sessionId, false);
}

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

describe("session pane derivation", () => {
  test("keeps selected session panes first and appends canvases within the four-pane grid cap", () => {
    const firstCanvas = canvas();
    const secondCanvas = canvas({
      key: JSON.stringify(["user:documint", "documint-markdown-agent", "notes"]),
      instanceId: "notes",
      title: "Notes",
      revision: 3,
    });

    expect(
      deriveVisibleSessionGridPanes({
        selectedSessionIds: ["A", "B"],
        linkedPanesBySource: {
          A: [createLinkedCanvasPane("A", firstCanvas), createLinkedCanvasPane("A", secondCanvas)],
        },
      }),
    ).toEqual([
      { kind: "session", id: "session:A", sessionId: "A", isLinkedOnly: false },
      { kind: "session", id: "session:B", sessionId: "B", isLinkedOnly: false },
      {
        kind: "canvas",
        id: createCanvasPaneId("A", firstCanvas),
        sourceSessionId: "A",
        canvas: firstCanvas,
      },
      {
        kind: "canvas",
        id: createCanvasPaneId("A", secondCanvas),
        sourceSessionId: "A",
        canvas: secondCanvas,
      },
    ]);
  });

  test("prioritizes canvases over linked-only sessions without evicting selected sessions", () => {
    const firstCanvas = canvas();
    const secondCanvas = canvas({
      key: JSON.stringify(["user:documint", "documint-markdown-agent", "notes"]),
      instanceId: "notes",
      title: "Notes",
      revision: 3,
    });

    expect(
      deriveVisibleSessionGridPanes({
        selectedSessionIds: ["A"],
        linkedPanesBySource: {
          A: [
            createLinkedSessionPane("B"),
            createLinkedCanvasPane("A", firstCanvas),
            createLinkedCanvasPane("A", secondCanvas),
          ],
        },
      }),
    ).toEqual([
      { kind: "session", id: "session:A", sessionId: "A", isLinkedOnly: false },
      {
        kind: "canvas",
        id: createCanvasPaneId("A", firstCanvas),
        sourceSessionId: "A",
        canvas: firstCanvas,
      },
      {
        kind: "canvas",
        id: createCanvasPaneId("A", secondCanvas),
        sourceSessionId: "A",
        canvas: secondCanvas,
      },
      { kind: "session", id: "session:B", sessionId: "B", isLinkedOnly: true },
    ]);
  });

  test("places artifact panes after selected sessions and before canvases", () => {
    const firstCanvas = canvas();
    const markdownPane = createArtifactPane("A", "/tmp/session-state/plan.md");

    expect(
      deriveVisibleSessionGridPanes({
        selectedSessionIds: ["A"],
        linkedPanesBySource: {
          A: [createLinkedSessionPane("B"), markdownPane, createLinkedCanvasPane("A", firstCanvas)],
        },
      }),
    ).toEqual([
      { kind: "session", id: "session:A", sessionId: "A", isLinkedOnly: false },
      markdownPane,
      {
        kind: "canvas",
        id: createCanvasPaneId("A", firstCanvas),
        sourceSessionId: "A",
        canvas: firstCanvas,
      },
      { kind: "session", id: "session:B", sessionId: "B", isLinkedOnly: true },
    ]);
  });

  test("classifies HTML artifacts as HTML panes", () => {
    const htmlPane = createArtifactPane("A", "/tmp/session-state/preview.html");

    expect(htmlPane).toEqual({
      kind: "html",
      id: "artifact:A:/tmp/session-state/preview.html",
      sourceSessionId: "A",
      path: "/tmp/session-state/preview.html",
      title: "preview.html",
      mode: "shared",
    });
  });

  test("defaults automation artifacts to read mode", () => {
    const sourceSessionId = "toy-box-auto-layout-review--run-123";

    expect(createArtifactPane(sourceSessionId, "/tmp/session-state/plan.md").mode).toBe("read");
  });

  test("publishes artifacts with linked panes and preserves artifact modes", () => {
    const path = "/tmp/session-state/plan.md";
    const previousPane = {
      ...createArtifactPane("A", path),
      mode: "edit" as const,
    };

    expect(createLinkedPanes("A", ["B"], [], [path], [previousPane])).toEqual([
      createLinkedSessionPane("B"),
      previousPane,
    ]);
  });

  test("follows linked session descendants without requiring list availability", () => {
    const descendantCanvas = canvas();

    expect(
      deriveVisibleSessionGridPanes({
        selectedSessionIds: ["A"],
        linkedPanesBySource: {
          A: [createLinkedSessionPane("B")],
          B: [createLinkedSessionPane("C"), createLinkedCanvasPane("B", descendantCanvas)],
        },
      }),
    ).toEqual([
      { kind: "session", id: "session:A", sessionId: "A", isLinkedOnly: false },
      {
        kind: "canvas",
        id: createCanvasPaneId("B", descendantCanvas),
        sourceSessionId: "B",
        canvas: descendantCanvas,
      },
      { kind: "session", id: "session:B", sessionId: "B", isLinkedOnly: true },
      { kind: "session", id: "session:C", sessionId: "C", isLinkedOnly: true },
    ]);
  });

  test("derives open session ids from the rendered panes", () => {
    const pane = createLinkedCanvasPane("A", canvas());
    const markdownPane = createArtifactPane("A", "/tmp/session-state/plan.md");

    expect(
      deriveOpenSessionIds([
        { kind: "session", id: "session:A", sessionId: "A", isLinkedOnly: false },
        pane,
        markdownPane,
        createLinkedSessionPane("B"),
      ]),
    ).toEqual(["A", "B"]);
  });
});

describe("artifact auto-focus", () => {
  const automationSessionId = "toy-box-auto-daily-report--run-123";
  const chatPane = selectedSessionPane(automationSessionId);
  const artifactPane = createArtifactPane(automationSessionId, "/tmp/session-state/report.md");
  const regularChatPane = selectedSessionPane("session-1");
  const regularArtifactPane = createArtifactPane("session-1", "/tmp/session-state/notes.md");

  test("always scope focuses session and automation artifact panes", () => {
    expect(
      resolveArtifactAutoFocus(new Set([chatPane.id]), [chatPane, artifactPane], "always")
        .focusPane,
    ).toEqual(artifactPane);

    expect(
      resolveArtifactAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularArtifactPane],
        "always",
      ).focusPane,
    ).toEqual(regularArtifactPane);
  });

  test("automations scope focuses automation artifacts only", () => {
    const { focusPane, seenPaneIds } = resolveArtifactAutoFocus(
      new Set([chatPane.id]),
      [chatPane, artifactPane],
      "automations",
    );

    expect(focusPane).toEqual(artifactPane);
    expect(seenPaneIds).toEqual(new Set([chatPane.id, artifactPane.id]));

    expect(
      resolveArtifactAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularArtifactPane],
        "automations",
      ).focusPane,
    ).toBeUndefined();
  });

  test("sessions scope focuses regular session artifacts only", () => {
    expect(
      resolveArtifactAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularArtifactPane],
        "sessions",
      ).focusPane,
    ).toEqual(regularArtifactPane);

    expect(
      resolveArtifactAutoFocus(new Set([chatPane.id]), [chatPane, artifactPane], "sessions")
        .focusPane,
    ).toBeUndefined();
  });

  test("never scope does not focus artifacts", () => {
    expect(
      resolveArtifactAutoFocus(new Set([chatPane.id]), [chatPane, artifactPane], "never").focusPane,
    ).toBeUndefined();

    expect(
      resolveArtifactAutoFocus(
        new Set([regularChatPane.id]),
        [regularChatPane, regularArtifactPane],
        "never",
      ).focusPane,
    ).toBeUndefined();
  });

  test("focuses a pane at most once per appearance", () => {
    const first = resolveArtifactAutoFocus(
      new Set([chatPane.id]),
      [chatPane, artifactPane],
      "always",
    );

    expect(
      resolveArtifactAutoFocus(first.seenPaneIds, [chatPane, artifactPane], "always").focusPane,
    ).toBeUndefined();
  });

  test("ignores newly appearing session and canvas panes", () => {
    expect(
      resolveArtifactAutoFocus(
        new Set(),
        [chatPane, createLinkedCanvasPane(automationSessionId, canvas())],
        "always",
      ).focusPane,
    ).toBeUndefined();
  });

  test("does not claim focus in multi-session layouts, but still marks panes seen", () => {
    const multi = resolveArtifactAutoFocus(
      new Set(),
      [chatPane, selectedSessionPane("session-2"), artifactPane],
      "always",
    );
    expect(multi.focusPane).toBeUndefined();

    // Back to a single-session layout: the artifact was already seen, so it
    // does not retroactively grab focus.
    expect(
      resolveArtifactAutoFocus(multi.seenPaneIds, [chatPane, artifactPane], "always").focusPane,
    ).toBeUndefined();
  });

  test("prunes departed panes so a reopened source can focus its artifact again", () => {
    const opened = resolveArtifactAutoFocus(new Set(), [chatPane, artifactPane], "always");
    expect(opened.focusPane).toEqual(artifactPane);

    // Closing the source clears its panes and re-arms the trigger.
    const closed = resolveArtifactAutoFocus(opened.seenPaneIds, [], "always");
    expect(closed.seenPaneIds).toEqual(new Set());

    expect(
      resolveArtifactAutoFocus(closed.seenPaneIds, [chatPane, artifactPane], "always").focusPane,
    ).toEqual(artifactPane);
  });
});

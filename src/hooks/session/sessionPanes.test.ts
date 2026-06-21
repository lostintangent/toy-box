import { describe, expect, test } from "bun:test";
import {
  createCanvasPaneId,
  createLinkedCanvasPane,
  createLinkedSessionPane,
  deriveOpenSessionIds,
  deriveVisibleSessionGridPanes,
} from "@/hooks/session/sessionPanes";
import type { SessionCanvas } from "@/types";

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

    expect(
      deriveOpenSessionIds([
        { kind: "session", id: "session:A", sessionId: "A", isLinkedOnly: false },
        pane,
        createLinkedSessionPane("B"),
      ]),
    ).toEqual(["A", "B"]);
  });
});

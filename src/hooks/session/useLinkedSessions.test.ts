import { describe, expect, test } from "bun:test";
import { deriveVisibleSessionIds, reconcileDismissedLinkedSessionIds } from "./useLinkedSessions";

describe("useLinkedSessions helpers", () => {
  test("derives linked sessions from the selected sessions", () => {
    const linkedSessionIdsBySource = {
      A: ["X"],
      B: ["Y"],
    };

    expect(deriveVisibleSessionIds(["A", "B"], linkedSessionIdsBySource, new Set())).toEqual([
      "A",
      "B",
      "X",
      "Y",
    ]);
  });

  test("dismissed linked sessions stay hidden while they remain reachable", () => {
    const linkedSessionIdsBySource = {
      A: ["X"],
      B: ["X"],
    };
    const dismissedLinkedSessionIds = new Set(["X"]);

    expect(
      deriveVisibleSessionIds(["A", "B"], linkedSessionIdsBySource, dismissedLinkedSessionIds),
    ).toEqual(["A", "B"]);

    expect(
      reconcileDismissedLinkedSessionIds(
        dismissedLinkedSessionIds,
        ["A", "B"],
        linkedSessionIdsBySource,
      ),
    ).toEqual(new Set(["X"]));
  });

  test("closing a linked session also hides its linked descendants", () => {
    const linkedSessionIdsBySource = {
      A: ["X"],
      X: ["Y"],
    };

    expect(deriveVisibleSessionIds(["A"], linkedSessionIdsBySource, new Set(["X"]))).toEqual(["A"]);
  });

  test("selected sessions stay visible even if they were previously dismissed as linked", () => {
    expect(deriveVisibleSessionIds(["X"], {}, new Set(["X"]))).toEqual(["X"]);
  });

  test("shared linked descendants stay deduplicated while preserving later siblings", () => {
    expect(
      deriveVisibleSessionIds(
        ["A", "B"],
        {
          A: ["X"],
          B: ["X", "Y"],
        },
        new Set(),
      ),
    ).toEqual(["A", "B", "X", "Y"]);
  });

  test("dismissed linked sessions are forgotten once they leave the linked graph", () => {
    expect(reconcileDismissedLinkedSessionIds(new Set(["X"]), ["B"], { B: [] })).toEqual(new Set());
  });

  test("limits the derived grid to four panes", () => {
    const linkedSessionIdsBySource = {
      A: ["X", "Y"],
      B: ["Z"],
    };

    expect(deriveVisibleSessionIds(["A", "B"], linkedSessionIdsBySource, new Set())).toEqual([
      "A",
      "B",
      "X",
      "Y",
    ]);
  });
});

import { describe, expect, onTestFinished, test } from "bun:test";
import { useSelector } from "@tanstack/react-store";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { INBOX_PANE, createArtifactPane } from "@/lib/workspace/panes";
import { createLinkedPanesStore, updateArtifactPaneMode } from "./linkedPanes";

describe("linked pane store", () => {
  test("preserves one publisher's selection when another publisher changes", () => {
    const store = createLinkedPanesStore();
    const firstPane = createArtifactPane("session-a", "first.md", "edit");
    const secondPane = createArtifactPane("session-b", "second.md", "edit");

    store.actions.publishLinkedPanes("publisher-a", [firstPane]);
    const firstSelection = store.get()["publisher-a"];

    store.actions.publishLinkedPanes("publisher-b", [secondPane]);

    expect(store.get()["publisher-a"]).toBe(firstSelection);
    expect(store.get()["publisher-b"]).toEqual([secondPane]);
  });

  test("does not notify for a semantically unchanged publication", () => {
    const store = createLinkedPanesStore();
    const pane = createArtifactPane("session-a", "result.md", "edit");
    store.actions.publishLinkedPanes("publisher-a", [pane]);
    const state = store.get();
    let updates = 0;
    const subscription = store.subscribe(() => updates++);
    onTestFinished(() => subscription.unsubscribe());

    store.actions.publishLinkedPanes("publisher-a", [{ ...pane }]);

    expect(store.get()).toBe(state);
    expect(updates).toBe(0);
  });

  test("provides a stable server snapshot without a provider", () => {
    const store = createLinkedPanesStore();

    function PublishedPanesProbe() {
      const paneCount = useSelector(
        store,
        (linkedPanes) => linkedPanes["missing-publisher"]?.length ?? 0,
      );
      return createElement("span", null, paneCount);
    }

    expect(renderToString(createElement(PublishedPanesProbe))).toBe("<span>0</span>");
  });

  test("removes an explicitly cleared publisher", () => {
    const store = createLinkedPanesStore();
    const pane = createArtifactPane("session-a", "result.md", "edit");
    store.actions.publishLinkedPanes("publisher-a", [pane]);

    store.actions.clearLinkedPanes("publisher-a");

    expect(store.get()).toEqual({});
  });
});

describe("linked pane layout", () => {
  test("updates an artifact published by a pane other than its source session", () => {
    const artifactPane = createArtifactPane("inbox-1", "result.md", "edit");
    const current = { [INBOX_PANE.id]: [artifactPane] };

    expect(updateArtifactPaneMode(current, artifactPane, "shared")).toEqual({
      [INBOX_PANE.id]: [{ ...artifactPane, mode: "shared" }],
    });
  });

  test("preserves identity when the requested mode is already active", () => {
    const artifactPane = createArtifactPane("inbox-1", "result.md", "edit");
    const current = { [INBOX_PANE.id]: [artifactPane] };

    expect(updateArtifactPaneMode(current, artifactPane, "edit")).toBe(current);
  });
});

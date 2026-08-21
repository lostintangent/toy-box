import { describe, expect, test } from "bun:test";
import { compareIntentToSavedVersion, saveIntentVersion } from "./checkpoints";
import {
  setAllIntentSectionsCollapsed,
  setIntentRecordsView,
  setIntentSectionCollapsed,
  updateIntentExhibit,
  updateIntentRecord,
} from "./transitions";
import { exhibitsFixture, fixture, mapSection, parse, recordsSection } from "./testFixtures";

describe("intent checkpoints", () => {
  test("compares the graph with a compact durable saved version", () => {
    const saved = saveIntentVersion(fixture(), "2026-03-19T12:00:00.000Z");
    expect(saved.savedVersion?.items.length).toBeGreaterThan(1);
    expect(parse(saved)).toMatchObject({ ok: true });
    expect(compareIntentToSavedVersion(saved)).toEqual({
      savedAt: "2026-03-19T12:00:00.000Z",
      changes: [],
    });

    const edited = updateIntentRecord(saved, "ordinary-tools", {
      subject: "everyday tools",
      change: "modified",
      values: { shape: "declared", content: ["shared", "text"] },
      explanation: "The shared renderer now owns these tools.",
      provenance: "ToolCallMessage.tsx#ToolCallMessage",
    });
    expect(compareIntentToSavedVersion(edited)?.changes).toEqual([
      {
        status: "changed",
        key: "record:ordinary-tools",
        kind: "record",
        label: "everyday tools",
        previousLabel: "ordinary tools",
        entityId: "ordinary-tools",
      },
    ]);

    const resaved = saveIntentVersion(edited, "2026-03-19T13:00:00.000Z");
    expect(compareIntentToSavedVersion(resaved)?.changes).toEqual([]);

    const invalid = structuredClone(resaved);
    const firstSavedItem = invalid.savedVersion?.items[0];
    if (!firstSavedItem) throw new Error("Missing saved-version fixture");
    firstSavedItem.key = "wrong-prefix";
    expect(parse(invalid)).toMatchObject({
      ok: false,
      error: expect.stringContaining("must use its"),
    });
  });

  test("tracks exact exhibit edits in the compact saved version", () => {
    const saved = saveIntentVersion(exhibitsFixture(), "2026-03-19T12:00:00.000Z");
    const edited = updateIntentExhibit(saved, "body-declaration", {
      title: "Declared body shape",
      kind: "code",
      change: "new",
      description: "The smallest declaration ordinary tools provide.",
      language: "typescript",
      content: "const body = renderToolBody(result);\n",
    });

    expect(compareIntentToSavedVersion(edited)?.changes).toContainEqual({
      status: "changed",
      key: "exhibit:body-declaration",
      kind: "exhibit",
      label: "Declared body shape",
      entityId: "body-declaration",
    });
  });

  test("persists section display preferences without creating checkpoint drift", () => {
    const saved = saveIntentVersion(fixture(), "2026-03-19T12:00:00.000Z");
    const collapsed = setIntentSectionCollapsed(saved, "overview", true);

    expect(collapsed.sections.find((section) => section.id === "overview")?.collapsed).toBe(true);
    expect(compareIntentToSavedVersion(collapsed)?.changes).toEqual([]);

    const allCollapsed = setAllIntentSectionsCollapsed(collapsed, true);
    expect(allCollapsed.sections.every((section) => section.collapsed)).toBe(true);
    expect(compareIntentToSavedVersion(allCollapsed)?.changes).toEqual([]);

    const cards = setIntentRecordsView(allCollapsed, "tool-corpus", "cards");
    expect(recordsSection(cards, "tool-corpus").view).toBe("cards");
    expect(compareIntentToSavedVersion(cards)?.changes).toEqual([]);

    const nestedTable = setIntentRecordsView(cards, "concepts", "table");
    expect(recordsSection(nestedTable, "concepts").view).toBe("table");
    expect(compareIntentToSavedVersion(nestedTable)?.changes).toEqual([]);
    expect(setIntentRecordsView(nestedTable, "concepts", "table")).toBe(nestedTable);
    expect(parse(nestedTable)).toMatchObject({ ok: true });
  });

  test("tracks authored map changes in the compact saved version", () => {
    const saved = saveIntentVersion(fixture(), "2026-03-19T12:00:00.000Z");
    const edited = structuredClone(saved);
    mapSection(edited, "shared-rendering-path").title = "Trace the ordinary rendering path";

    expect(compareIntentToSavedVersion(edited)?.changes).toContainEqual({
      status: "changed",
      key: "section:shared-rendering-path",
      kind: "section",
      label: "Trace the ordinary rendering path",
      previousLabel: "Follow the shared rendering path",
      entityId: "shared-rendering-path",
    });
  });
});

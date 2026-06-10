import { describe, expect, test } from "bun:test";
import { resolveSessionStateSyncAction } from "./sessionSync";

describe("resolveSessionStateSyncAction", () => {
  test("initializes a fresh draft once", () => {
    expect(
      resolveSessionStateSyncAction({
        isDraft: true,
        hasSynced: false,
        isStreaming: false,
        hasSnapshot: false,
      }),
    ).toBe("initialize-draft");
  });

  test("does not clear an already-initialized draft when streaming changes", () => {
    expect(
      resolveSessionStateSyncAction({
        isDraft: true,
        hasSynced: true,
        isStreaming: true,
        hasSnapshot: false,
      }),
    ).toBe("skip");

    expect(
      resolveSessionStateSyncAction({
        isDraft: true,
        hasSynced: true,
        isStreaming: false,
        hasSnapshot: false,
      }),
    ).toBe("skip");
  });

  test("keeps live stream state authoritative over snapshots", () => {
    expect(
      resolveSessionStateSyncAction({
        isDraft: false,
        hasSynced: true,
        isStreaming: true,
        hasSnapshot: true,
      }),
    ).toBe("skip");
  });

  test("syncs idle sessions from snapshots when data is available", () => {
    expect(
      resolveSessionStateSyncAction({
        isDraft: false,
        hasSynced: false,
        isStreaming: false,
        hasSnapshot: true,
      }),
    ).toBe("sync-snapshot");
  });
});

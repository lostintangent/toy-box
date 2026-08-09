import { describe, expect, test } from "bun:test";
import { workspaceFileId } from "./model";
import { fileQueries } from "./queries";

describe("file query identity", () => {
  test("keys directory listings by path and visibility", () => {
    expect([...fileQueries.browse("/repo", false).queryKey]).toEqual([
      "files",
      "browse",
      "/repo",
      false,
    ]);
    expect([...fileQueries.browse(undefined, true).queryKey]).toEqual([
      "files",
      "browse",
      null,
      true,
    ]);
  });

  test("keys the durable snapshot by workspace file identity", () => {
    const file = { type: "session", sessionId: "session-a", path: "notes.md" } as const;
    const query = fileQueries.detail(file);

    expect([...query.queryKey]).toEqual([...fileQueries.detailKey(workspaceFileId(file))]);
    expect(query.refetchOnMount).toBe("always");
    expect(query.refetchOnWindowFocus).toBe(false);
    expect(query.refetchOnReconnect).toBe(false);
  });
});

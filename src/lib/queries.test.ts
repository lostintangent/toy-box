import { describe, expect, test } from "bun:test";
import { sessionQueries, workspaceQueries } from "./queries";

describe("live query refresh policies", () => {
  test("shared-state queries leave visibility and reconnect repair to SSE", () => {
    for (const query of [workspaceQueries.state(), sessionQueries.state()]) {
      expect(query.refetchOnWindowFocus).toBe(false);
      expect(query.refetchOnReconnect).toBe(false);
    }
  });

  test("session detail retains its independent stream recovery policy", () => {
    const query = sessionQueries.detail("session-a");

    expect(query.refetchOnWindowFocus).toBe("always");
    expect(query.refetchOnReconnect).toBe("always");
  });
});

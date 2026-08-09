import { describe, expect, test } from "bun:test";
import { workspaceQueries } from "@workspace/queries";
import { selectNonWorkerSessions, sessionQueries, skillQueries } from "./queries";

describe("session list projection", () => {
  test("excludes every classified worker while preserving its canonical metadata", () => {
    const standard = {
      sessionId: "standard",
      startTime: new Date(0),
      modifiedTime: new Date(0),
      summary: "Standard",
      isRemote: false,
    };
    const workers = ["session-worker", "file-worker", "app-worker"].map((sessionId) => ({
      ...standard,
      sessionId,
      summary: "Implementation detail",
    }));
    const state = {
      sessions: [...workers, standard],
      worktrees: {},
      workerSessionParents: Object.fromEntries(workers.map(({ sessionId }) => [sessionId, null])),
    };

    expect(selectNonWorkerSessions(state)).toEqual([standard]);
    expect(state.sessions).toEqual([...workers, standard]);
  });
});

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

describe("skill query identity", () => {
  test("shares discovery by working directory and distinguishes host-level discovery", () => {
    expect(skillQueries.byCwd("/repo")).toEqual(["skills", "/repo", "standard"]);
    expect(skillQueries.byCwd("/repo")).toEqual(skillQueries.byCwd("/repo"));
    expect(skillQueries.byCwd("/other")).not.toEqual(skillQueries.byCwd("/repo"));
    expect(skillQueries.byCwd()).toEqual(["skills", null, "standard"]);
    expect(skillQueries.byCwd("/repo", "hyper")).toEqual(["skills", "/repo", "hyper"]);
    expect(skillQueries.byCwd("/repo", "hyper")).not.toEqual(skillQueries.byCwd("/repo"));
  });
});

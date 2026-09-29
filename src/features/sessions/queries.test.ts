import { describe, expect, test } from "bun:test";
import { selectAutomationSessionIds, selectNonWorkerSessions, skillQueries } from "./queries";
import type { SessionsState } from "./model";

describe("session list projection", () => {
  test("excludes managed worker sessions while preserving canonical metadata", () => {
    const standard = {
      id: "standard",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      title: "Standard",
    };
    const workers = ["session-worker", "file-worker", "app-worker"].map((id) => ({
      ...standard,
      id,
      title: "Implementation detail",
    }));
    const state: SessionsState = {
      sessions: [...workers, standard],
      worktrees: {},
      ownership: Object.fromEntries(
        workers.map(({ id }) => [id, { type: "worker", parentSessionId: null }]),
      ),
    };

    expect(selectNonWorkerSessions(state)).toEqual([standard]);
    expect(state.sessions).toEqual([...workers, standard]);
  });

  test("automation membership does not require a backing session", () => {
    const state: SessionsState = {
      sessions: [],
      worktrees: {},
      ownership: {
        scheduled: { type: "automation" },
        inbox: { type: "worker", parentSessionId: null },
      },
    };
    expect(selectAutomationSessionIds(state)).toEqual(["scheduled"]);
  });
});

describe("skill query identity", () => {
  test("shares discovery by working directory and distinguishes host-level discovery", () => {
    expect(skillQueries.byCwd("/repo")).toEqual(["skills", "/repo", "standard", null]);
    expect(skillQueries.byCwd("/repo")).toEqual(skillQueries.byCwd("/repo"));
    expect(skillQueries.byCwd("/other")).not.toEqual(skillQueries.byCwd("/repo"));
    expect(skillQueries.byCwd()).toEqual(["skills", null, "standard", null]);
    expect(skillQueries.byCwd("/repo", "hyper")).toEqual(["skills", "/repo", "hyper", null]);
    expect(skillQueries.byCwd("/repo", "hyper")).not.toEqual(skillQueries.byCwd("/repo"));
  });
});

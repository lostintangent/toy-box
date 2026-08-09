import { describe, expect, test } from "bun:test";
import type { AppInstance, AppStateDefinition, AppUpdate } from "@apps/model";
import { AppStateStore } from "./state";

const app: AppInstance = {
  id: "app-a",
  definitionId: "kanban",
  title: "Launch board",
  color: "#f59e0b",
  state: { cards: [] },
  revision: 0,
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
};

const stateSchema = { type: "object" } as const satisfies AppStateDefinition["schema"];

describe("app state store", () => {
  test("replays a draft update over a conflicting remote revision", async () => {
    const commits: AppUpdate[] = [];
    const remote: AppInstance = {
      ...app,
      state: { cards: ["remote"] },
      revision: 1,
      updatedAt: "2026-07-28T12:01:00.000Z",
    };
    const state = new AppStateStore(app, stateSchema, async (input) => {
      commits.push(input);
      if (commits.length === 1) return { status: "conflict", app: remote };
      return {
        status: "updated",
        app: {
          ...remote,
          state: input.state!,
          revision: 2,
          updatedAt: "2026-07-28T12:02:00.000Z",
        },
      };
    });

    const update = state.updateState<{ cards: string[] }>((draft) => {
      draft.cards.push("local");
    });
    expect(commits).toEqual([]);
    await state.flush();
    await update;

    expect(commits).toEqual([
      { expectedRevision: 0, state: { cards: ["local"] } },
      { expectedRevision: 1, state: { cards: ["remote", "local"] } },
    ]);
    expect(state.store.state).toMatchObject({
      revision: 2,
      state: { cards: ["remote", "local"] },
    });
  });

  test("shows edits immediately and debounces rapid changes into one save", async () => {
    const commits: AppUpdate[] = [];
    const state = new AppStateStore(app, stateSchema, async (input) => {
      commits.push(input);
      return {
        status: "updated",
        app: {
          ...app,
          state: input.state!,
          revision: 1,
          updatedAt: "2026-07-28T12:01:00.000Z",
        },
      };
    });

    const first = state.updateState(() => ({ pattern: "a" }));
    const second = state.updateState(() => ({ pattern: "ab" }));
    const third = state.updateState(() => ({ pattern: "abc" }));

    expect(state.store.state.state).toEqual({ pattern: "abc" });
    expect(commits).toEqual([]);
    await state.flush();
    await Promise.all([first, second, third]);

    expect(commits).toEqual([{ expectedRevision: 0, state: { pattern: "abc" } }]);
  });

  test("flushes changes made during an in-flight save as a later save", async () => {
    let releaseFirst!: () => void;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const commits: AppUpdate[] = [];
    const state = new AppStateStore(app, stateSchema, async (input) => {
      commits.push(input);
      if (commits.length === 1) await firstCommit;
      return {
        status: "updated",
        app: {
          ...app,
          state: input.state ?? app.state,
          revision: commits.length,
          updatedAt: `2026-07-28T12:0${commits.length}:00.000Z`,
        },
      };
    });

    const first = state.updateState(() => ({ pattern: "a" }));
    expect(state.store.state.state).toEqual({ pattern: "a" });
    const firstFlush = state.flush();
    expect(commits).toEqual([{ expectedRevision: 0, state: { pattern: "a" } }]);

    const second = state.updateState(() => ({ pattern: "ab" }));
    const third = state.updateState(() => ({ pattern: "abc" }));
    expect(state.store.state.state).toEqual({ pattern: "abc" });
    expect(commits).toEqual([{ expectedRevision: 0, state: { pattern: "a" } }]);

    const secondFlush = state.flush();
    releaseFirst();
    await Promise.all([firstFlush, secondFlush, first, second, third]);

    expect(commits).toEqual([
      { expectedRevision: 0, state: { pattern: "a" } },
      { expectedRevision: 1, state: { pattern: "abc" } },
    ]);
    expect(state.store.state.state).toEqual({ pattern: "abc" });
  });

  test("defers a workspace acknowledgement until its pending update retires", async () => {
    let finishCommit!: (result: { status: "updated"; app: AppInstance }) => void;
    const commit = new Promise<{ status: "updated"; app: AppInstance }>((resolve) => {
      finishCommit = resolve;
    });
    const state = new AppStateStore(app, stateSchema, () => commit);

    const update = state.updateState<{ cards: string[] }>((draft) => {
      draft.cards.push("local");
    });
    const flush = state.flush();
    const acknowledgement: AppInstance = {
      ...app,
      state: { cards: ["local"] },
      revision: 1,
      updatedAt: "2026-07-28T12:01:00.000Z",
    };
    state.sync(acknowledgement);

    expect(state.store.state.state).toEqual({ cards: ["local"] });
    finishCommit({ status: "updated", app: acknowledgement });
    await Promise.all([flush, update]);
    expect(state.store.state).toEqual(acknowledgement);
  });

  test("ignores stale workspace echoes and accepts a newer app revision", () => {
    const state = new AppStateStore({ ...app, revision: 2 }, stateSchema, async () => {
      throw new Error("not used");
    });

    state.sync({ ...app, revision: 1, title: "Stale" });
    expect(state.store.state.title).toBe(app.title);

    state.sync({ ...app, revision: 3, title: "Fresh" });
    expect(state.store.state.title).toBe("Fresh");
  });

  test("rolls back optimistic updates when persistence fails", async () => {
    const state = new AppStateStore(app, stateSchema, async () => {
      throw new Error("offline");
    });

    const update = state.updateState<{ cards: string[] }>((draft) => {
      draft.cards.push("local");
    });
    expect(state.store.state.state).toEqual({ cards: ["local"] });
    const [updateError, flushError] = await Promise.all([
      update.then(
        () => null,
        (error: unknown) => error,
      ),
      state.flush().then(
        () => null,
        (error: unknown) => error,
      ),
    ]);
    expect(updateError).toEqual(new Error("offline"));
    expect(flushError).toEqual(new Error("offline"));
    expect(state.store.state).toEqual(app);
  });

  test("resolves an unchanged update without scheduling a save", async () => {
    const commits: AppUpdate[] = [];
    const state = new AppStateStore(app, stateSchema, async (input) => {
      commits.push(input);
      return { status: "updated", app };
    });

    await state.updateState(() => {});
    await state.flush();

    expect(commits).toEqual([]);
  });

  test("isolates completed state from both the confirmed snapshot and an escaped draft", async () => {
    let draft!: { cards: string[] };
    const state = new AppStateStore(app, stateSchema, async (input) => ({
      status: "updated",
      app: {
        ...app,
        state: input.state!,
        revision: 1,
        updatedAt: "2026-07-28T12:01:00.000Z",
      },
    }));

    const update = state.updateState<{ cards: string[] }>((next) => {
      draft = next;
      next.cards.push("local");
    });

    expect(app.state).toEqual({ cards: [] });
    expect(state.store.state.state).toEqual({ cards: ["local"] });
    draft.cards.push("escaped");
    expect(state.store.state.state).toEqual({ cards: ["local"] });

    await state.flush();
    await update;
  });

  test("rejects an oversized draft before publishing it optimistically", async () => {
    const state = new AppStateStore(app, stateSchema, async () => {
      throw new Error("not used");
    });

    const update = state.updateState(() => ({ value: "x".repeat(65 * 1024) }));

    await expect(update).rejects.toThrow("JSON must be at most");
    expect(state.store.state).toEqual(app);
  });

  test("rejects an invalid draft before publishing it optimistically", async () => {
    const cardsSchema: AppStateDefinition["schema"] = {
      type: "object",
      properties: {
        cards: { type: "array", items: { type: "string" } },
      },
      required: ["cards"],
      additionalProperties: false,
    };
    const state = new AppStateStore(app, cardsSchema, async () => {
      throw new Error("not used");
    });

    const update = state.updateState(() => ({ cards: [42] }));

    await expect(update).rejects.toThrow();
    expect(state.store.state).toEqual(app);
  });
});

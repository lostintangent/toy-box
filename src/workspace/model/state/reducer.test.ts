import { describe, expect, test } from "bun:test";
import type { Automation } from "@automations/model";
import {
  createEmptyWorkspaceState,
  reduceWorkspaceSessionState,
  reduceWorkspaceState,
  type WorkspaceSessionEvent,
  type WorkspaceSessionState,
} from "./reducer";
import type { WorkspaceEvent } from "@workspace/model/events";
import { sessionFile } from "@files/model";

const sessionId = "session-a";
const prompt = { text: "hello", origin: "client-a", updatedAt: 3 };

describe("workspace session state", () => {
  test("starts an artifact draft's first turn without retaining draft metadata", () => {
    let state: WorkspaceSessionState | undefined;

    state = transition(state, {
      type: "session.drafted",
      sessionId,
      createdAt: 1,
      artifactPath: "document.md",
    });
    expect(state).toEqual({
      status: "draft",
      createdAt: 1,
      artifactPath: "document.md",
    });

    state = transition(state, { type: "session.prompt.drafted", sessionId, prompt });
    expect(state).toEqual({
      status: "draft",
      createdAt: 1,
      artifactPath: "document.md",
      prompt,
    });

    state = transition(state, { type: "session.running", sessionId });
    expect(state).toEqual({ status: "running", prompt });
  });

  test("leaves a draft unchanged when its first turn fails to start", () => {
    const draft: WorkspaceSessionState = {
      status: "draft",
      createdAt: 1,
      artifactPath: "document.md",
      prompt,
    };
    expect(transition(draft, { type: "session.idle", sessionId })).toBe(draft);
  });

  test("makes running, unread, and idle mutually exclusive", () => {
    let state = transition(undefined, { type: "session.running", sessionId });
    expect(state).toEqual({ status: "running" });

    state = transition(state, { type: "session.unread", sessionId });
    expect(state).toEqual({ status: "unread" });

    state = transition(state, { type: "session.read", sessionId });
    expect(state).toBeUndefined();
  });

  test("keeps a composed prompt through runtime transitions", () => {
    let state = transition(undefined, { type: "session.prompt.drafted", sessionId, prompt });
    expect(state).toEqual({ status: "idle", prompt });

    state = transition(state, { type: "session.running", sessionId });
    expect(state).toEqual({ status: "running", prompt });

    state = transition(state, { type: "session.unread", sessionId });
    expect(state).toEqual({ status: "unread", prompt });

    state = transition(state, { type: "session.read", sessionId });
    expect(state).toEqual({ status: "idle", prompt });
  });

  test("canonicalizes idle sessions without prompts as missing", () => {
    expect(transition(undefined, { type: "session.idle", sessionId })).toBeUndefined();
    expect(transition({ status: "running" }, { type: "session.idle", sessionId })).toBeUndefined();
  });

  test("ignores stale draft events after a session starts running", () => {
    const running: WorkspaceSessionState = { status: "running" };
    expect(
      transition(running, {
        type: "session.drafted",
        sessionId,
        createdAt: 1,
      }),
    ).toBe(running);
  });
});

describe("workspace state reducer", () => {
  test("replaces settings atomically and ignores an equal echo", () => {
    const initial = createEmptyWorkspaceState();
    const settings = {
      ...initial.settings,
      accentColor: "#123abc" as const,
      defaultModel: { name: "gpt-5", reasoningEffort: "high" },
      pinnedSessionIds: ["session-a"],
    };
    const state = reduceWorkspaceState(initial, { type: "settings.changed", settings });

    expect(state.settings).toBe(settings);
    expect(
      reduceWorkspaceState(state, {
        type: "settings.changed",
        settings: {
          ...settings,
          defaultModel: { ...settings.defaultModel },
          pinnedSessionIds: [...settings.pinnedSessionIds],
        },
      }),
    ).toBe(state);
  });

  test("updates session and hyper state atomically and idempotently", () => {
    let state = createEmptyWorkspaceState();
    const event: WorkspaceEvent = {
      type: "session.drafted",
      sessionId,
      createdAt: 1,
      hyper: true,
    };

    state = reduceWorkspaceState(state, event);
    const duplicate = reduceWorkspaceState(state, event);

    expect(duplicate).toBe(state);
    expect(state.sessionStates[sessionId]).toEqual({ status: "draft", createdAt: 1 });
    expect(state.hyperSessionIds).toEqual([sessionId]);
  });

  test("delete clears every workspace fact for a session", () => {
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "session.drafted",
      sessionId,
      createdAt: 1,
      hyper: true,
    });
    state = reduceWorkspaceState(state, {
      type: "worker.started",
      worker: {
        type: "file",
        sessionId: "artifact-worker-a",
        ephemeral: true,
        file: sessionFile(sessionId, "plan.md"),
        name: "Respond to comment",
        metadata: { threadId: "thread-a" },
      },
    });
    state = reduceWorkspaceState(state, { type: "session.deleted", sessionId });
    expect(state).toEqual(createEmptyWorkspaceState());
  });

  test("creates, completes, and deletes inbox entries idempotently", () => {
    const pending = { id: "entry-a", createdAt: "2026-01-01T00:00:00.000Z" };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "inbox.entry.upserted",
      entry: pending,
    });

    expect(reduceWorkspaceState(state, { type: "inbox.entry.upserted", entry: pending })).toBe(
      state,
    );

    const completed = { ...pending, message: "Background work finished", artifact: "report.md" };
    state = reduceWorkspaceState(state, {
      type: "inbox.entry.upserted",
      entry: completed,
    });
    expect(state.inboxEntries).toEqual([completed]);

    state = reduceWorkspaceState(state, { type: "inbox.entry.deleted", entryId: pending.id });
    expect(state.inboxEntries).toEqual([]);
  });

  test("upserts, orders, and deletes automations idempotently", () => {
    const older = createAutomation({
      id: "automation-a",
      updatedAt: "2026-02-14T08:00:00.000Z",
    });
    const newer = createAutomation({
      id: "automation-b",
      updatedAt: "2026-02-14T09:00:00.000Z",
    });
    let state = createEmptyWorkspaceState();
    state = reduceWorkspaceState(state, { type: "automation.upserted", automation: older });
    state = reduceWorkspaceState(state, { type: "automation.upserted", automation: newer });

    expect(state.automations.map(({ id }) => id)).toEqual(["automation-b", "automation-a"]);
    expect(reduceWorkspaceState(state, { type: "automation.upserted", automation: newer })).toBe(
      state,
    );

    state = reduceWorkspaceState(state, {
      type: "automation.deleted",
      automationId: older.id,
    });
    expect(state.automations).toEqual([newer]);
    expect(
      reduceWorkspaceState(state, {
        type: "automation.deleted",
        automationId: "missing",
      }),
    ).toBe(state);
  });

  test("tracks worker links idempotently", () => {
    const worker = {
      type: "file" as const,
      sessionId: "artifact-worker-a",
      ephemeral: true,
      file: sessionFile(sessionId, "plan.md"),
      name: "Respond to comment",
      metadata: { threadId: "thread-a" },
    };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "worker.started",
      worker,
    });

    expect(state.workers).toEqual([worker]);
    expect(reduceWorkspaceState(state, { type: "worker.started", worker })).toBe(state);

    state = reduceWorkspaceState(state, {
      type: "worker.finished",
      sessionId: worker.sessionId,
    });
    expect(state.workers).toEqual([]);
    expect(
      reduceWorkspaceState(state, {
        type: "worker.finished",
        sessionId: worker.sessionId,
      }),
    ).toBe(state);
  });

  test("registers and updates custom editors idempotently", () => {
    const kind = {
      name: "json-tree",
      extensions: ["json"],
      icon: "json",
      editable: false,
      html: "<html>first</html>",
    };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "editor.registered",
      kind,
    });

    expect(state.customEditors).toEqual([kind]);
    expect(reduceWorkspaceState(state, { type: "editor.registered", kind })).toBe(state);

    const updated = { ...kind, editable: true, html: "<html>updated</html>" };
    state = reduceWorkspaceState(state, { type: "editor.registered", kind: updated });
    expect(state.customEditors).toEqual([updated]);
  });

  test("registers definitions and upserts saved app instances by revision", () => {
    const definition = {
      id: "kanban",
      title: "Kanban",
      color: "#f59e0b" as const,
      state: { schema: { type: "object" as const }, default: {} },
      accepts: [],
      revision: "definition-a",
    };
    const app = {
      id: "app-a",
      definitionId: definition.id,
      title: "Launch board",
      color: "#f59e0b" as const,
      state: { columns: [], cards: [] },
      revision: 0,
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    };
    let state = reduceWorkspaceState(createEmptyWorkspaceState(), {
      type: "app.registered",
      definition,
    });
    state = reduceWorkspaceState(state, { type: "app.upserted", app });

    expect(state.appDefinitions).toEqual([definition]);
    expect(state.apps).toEqual([app]);
    expect(reduceWorkspaceState(state, { type: "app.upserted", app })).toBe(state);

    const alphabeticallyFirst = {
      ...app,
      id: "app-b",
      title: "Alpha board",
    };
    state = reduceWorkspaceState(state, {
      type: "app.upserted",
      app: alphabeticallyFirst,
    });
    expect(state.apps).toEqual([alphabeticallyFirst, app]);

    const updated = {
      ...app,
      state: { cards: [{ id: "card-a" }] },
      revision: 1,
      updatedAt: "2026-07-28T12:01:00.000Z",
    };
    state = reduceWorkspaceState(state, { type: "app.upserted", app: updated });
    expect(state.apps).toEqual([alphabeticallyFirst, updated]);
    state = reduceWorkspaceState(state, {
      type: "worker.started",
      worker: { type: "app", sessionId: "app-worker", appId: app.id, ephemeral: true },
    });
    const shareEvent = {
      type: "app.share.created",
      share: {
        id: "share-a",
        sourceAppId: app.id,
        targetAppId: alphabeticallyFirst.id,
        mimeType: "text/plain",
        content: "Ship it",
        createdAt: "2026-07-28T12:02:00.000Z",
      },
    } as const;
    state = reduceWorkspaceState(state, shareEvent);
    expect(reduceWorkspaceState(state, shareEvent)).toBe(state);

    state = reduceWorkspaceState(state, { type: "app.share.deleted", shareId: "share-a" });
    expect(state.appShares).toEqual([]);
    expect(reduceWorkspaceState(state, { type: "app.share.deleted", shareId: "share-a" })).toBe(
      state,
    );
    state = reduceWorkspaceState(state, shareEvent);

    state = reduceWorkspaceState(state, { type: "app.deleted", appId: app.id });
    expect(state.apps).toEqual([alphabeticallyFirst]);
    expect(state.workers).toEqual([]);
    expect(state.appShares).toEqual([{ ...shareEvent.share, sourceAppId: null }]);
    expect(state.appDefinitions).toEqual([definition]);

    state = reduceWorkspaceState(state, {
      type: "app.deleted",
      appId: alphabeticallyFirst.id,
    });
    expect(state.appShares).toEqual([]);

    state = reduceWorkspaceState(state, {
      type: "app.unregistered",
      definitionId: definition.id,
    });
    expect(state.appDefinitions).toEqual([]);
    expect(
      reduceWorkspaceState(state, {
        type: "app.unregistered",
        definitionId: definition.id,
      }),
    ).toBe(state);
  });
});

function transition(
  state: WorkspaceSessionState | undefined,
  event: WorkspaceSessionEvent,
): WorkspaceSessionState | undefined {
  return reduceWorkspaceSessionState(state, event);
}

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: overrides.id ?? "automation-a",
    title: overrides.title ?? "Daily summary",
    prompt: overrides.prompt ?? "Summarize repo status.",
    model: overrides.model ?? { name: "gpt-5" },
    cron: overrides.cron ?? "0 9 * * *",
    createdAt: overrides.createdAt ?? "2026-02-14T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-14T00:00:00.000Z",
    nextRunAt: overrides.nextRunAt ?? "2026-02-14T09:00:00.000Z",
    lastRunAt: overrides.lastRunAt,
  };
}

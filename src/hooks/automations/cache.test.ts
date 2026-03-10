import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { applyAutomationsUpdateEvent } from "./cache";
import { automationQueries } from "@/lib/queries";
import type { Automation } from "@/types";

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: overrides.id ?? "automation-1",
    title: overrides.title ?? "Daily summary",
    prompt: overrides.prompt ?? "Summarize repo status.",
    model: overrides.model ?? "gpt-5",
    cron: overrides.cron ?? "0 9 * * *",
    reuseSession: overrides.reuseSession ?? false,
    createdAt: overrides.createdAt ?? "2026-02-14T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-14T00:00:00.000Z",
    nextRunAt: overrides.nextRunAt ?? "2026-02-14T09:00:00.000Z",
    lastRunAt: overrides.lastRunAt,
    lastRunSessionId: overrides.lastRunSessionId,
  };
}

describe("automations cache updates", () => {
  test("upserts by id and keeps updatedAt descending for added/updated/finished payloads", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<Automation[]>(automationQueries.all(), [
      createAutomation({ id: "a1", title: "old", updatedAt: "2026-02-14T08:00:00.000Z" }),
      createAutomation({ id: "a2", title: "older", updatedAt: "2026-02-14T07:00:00.000Z" }),
    ]);

    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.added",
      automation: createAutomation({
        id: "a1",
        title: "upserted-from-added",
        updatedAt: "2026-02-14T09:00:00.000Z",
      }),
    });

    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.updated",
      automation: createAutomation({
        id: "a1",
        title: "upserted-from-updated",
        updatedAt: "2026-02-14T10:00:00.000Z",
      }),
    });

    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.finished",
      automationId: "a1",
      sessionId: "toy-box-auto-a1--run-2",
      finishedAt: "2026-02-14T10:02:00.000Z",
      success: true,
      automation: createAutomation({
        id: "a1",
        title: "upserted-from-finished",
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
    });

    const automations = queryClient.getQueryData<Automation[]>(automationQueries.all()) ?? [];
    expect(automations).toHaveLength(2);
    expect(automations.map((automation) => automation.id)).toEqual(["a1", "a2"]);
    expect(automations[0]?.title).toBe("upserted-from-finished");
    expect(automations[0]?.updatedAt).toBe("2026-02-14T11:00:00.000Z");
  });

  test("keeps same reference for non-mutating running-state events", () => {
    const queryClient = new QueryClient();
    const seeded = [createAutomation({ id: "a1" })];
    queryClient.setQueryData<Automation[]>(automationQueries.all(), seeded);

    const before = queryClient.getQueryData<Automation[]>(automationQueries.all());

    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.started",
      automationId: "a1",
      sessionId: "toy-box-auto-a1--run-1",
      startedAt: "2026-02-14T10:00:00.000Z",
    });

    const afterStarted = queryClient.getQueryData<Automation[]>(automationQueries.all());
    expect(afterStarted).toBe(before);

    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.finished",
      automationId: "a1",
      sessionId: "toy-box-auto-a1--run-2",
      finishedAt: "2026-02-14T10:02:00.000Z",
      success: false,
    });

    const afterFinishedWithoutPayload = queryClient.getQueryData<Automation[]>(
      automationQueries.all(),
    );
    expect(afterFinishedWithoutPayload).toBe(before);
  });

  test("deletes existing ids and preserves reference when delete target is missing", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<Automation[]>(automationQueries.all(), [
      createAutomation({ id: "a1" }),
      createAutomation({ id: "a2" }),
    ]);

    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.deleted",
      automationId: "a1",
    });

    const afterDelete = queryClient.getQueryData<Automation[]>(automationQueries.all()) ?? [];
    expect(afterDelete.map((automation) => automation.id)).toEqual(["a2"]);

    const beforeMissingDelete = queryClient.getQueryData<Automation[]>(automationQueries.all());
    applyAutomationsUpdateEvent(queryClient, {
      type: "automation.deleted",
      automationId: "does-not-exist",
    });

    const afterMissingDelete = queryClient.getQueryData<Automation[]>(automationQueries.all());
    expect(afterMissingDelete).toBe(beforeMissingDelete);
  });
});

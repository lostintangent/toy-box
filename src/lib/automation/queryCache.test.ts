import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { automationQueries } from "@/lib/queries";
import type { Automation } from "@/types";
import { applyAutomationEvent } from "./queryCache";

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: overrides.id ?? "automation-1",
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

describe("automation query cache", () => {
  test("upserts by id and keeps updatedAt descending", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<Automation[]>(automationQueries.all(), [
      createAutomation({ id: "a1", title: "old", updatedAt: "2026-02-14T08:00:00.000Z" }),
      createAutomation({ id: "a2", title: "older", updatedAt: "2026-02-14T07:00:00.000Z" }),
    ]);

    applyAutomationEvent(queryClient, {
      type: "automation.added",
      automation: createAutomation({
        id: "a1",
        title: "upserted-from-added",
        updatedAt: "2026-02-14T09:00:00.000Z",
      }),
    });
    applyAutomationEvent(queryClient, {
      type: "automation.updated",
      automation: createAutomation({
        id: "a1",
        title: "upserted-from-update",
        updatedAt: "2026-02-14T11:00:00.000Z",
      }),
    });

    const automations = queryClient.getQueryData<Automation[]>(automationQueries.all()) ?? [];
    expect(automations.map((automation) => automation.id)).toEqual(["a1", "a2"]);
    expect(automations[0]).toMatchObject({
      title: "upserted-from-update",
      updatedAt: "2026-02-14T11:00:00.000Z",
    });
  });

  test("deletes existing ids and preserves identity for a missing id", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<Automation[]>(automationQueries.all(), [
      createAutomation({ id: "a1" }),
      createAutomation({ id: "a2" }),
    ]);

    applyAutomationEvent(queryClient, { type: "automation.deleted", automationId: "a1" });
    expect(
      queryClient.getQueryData<Automation[]>(automationQueries.all())?.map(({ id }) => id),
    ).toEqual(["a2"]);

    const before = queryClient.getQueryData<Automation[]>(automationQueries.all());
    applyAutomationEvent(queryClient, {
      type: "automation.deleted",
      automationId: "does-not-exist",
    });
    expect(queryClient.getQueryData<Automation[]>(automationQueries.all())).toBe(before);
  });
});

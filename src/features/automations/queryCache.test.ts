import { expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Automation } from "./model";
import { automationQueries } from "./queries";
import { applyAutomationListEvent } from "./queryCache";

const automation: Automation = {
  id: "automation",
  title: "Daily summary",
  prompt: "Summarize repo status.",
  model: { provider: "copilot", name: "gpt-5" },
  cron: "0 9 * * *",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nextRunAt: "2026-01-02T09:00:00.000Z",
};

test("events leave initial loading authoritative and maintain an ordered, idempotent catalog", () => {
  const client = createClient();
  const key = automationQueries.listKey();
  applyAutomationListEvent(client, { type: "automation.upserted", automation });
  expect(client.getQueryData(key)).toBeUndefined();
  client.setQueryData(key, []);
  const newer = { ...automation, id: "newer", updatedAt: "2026-01-02T00:00:00.000Z" };
  for (const item of [newer, automation, { ...newer }]) {
    applyAutomationListEvent(client, { type: "automation.upserted", automation: item });
  }
  expect(client.getQueryData<Automation[]>(key)).toEqual([newer, automation]);
  for (const id of [automation.id, automation.id, "missing"]) {
    applyAutomationListEvent(client, { type: "automation.deleted", automationId: id });
  }
  expect(client.getQueryData<Automation[]>(key)).toEqual([newer]);
});

test.each(["automation.upserted", "automation.deleted"] as const)(
  "%s replaces an overlapping snapshot with the complete current catalog",
  async (type) => {
    const client = createClient();
    const snapshot = Promise.withResolvers<Automation[]>();
    const other = { ...automation, id: "other" };
    const current = { ...automation, nextRunAt: "2026-01-03T09:00:00.000Z" };
    const latest = type === "automation.upserted" ? [current, other] : [other];
    client.setQueryData(automationQueries.listKey(), [automation]);
    let reads = 0;
    const pending = client.fetchQuery({
      ...automationQueries.list(),
      staleTime: 0,
      queryFn: () => (++reads === 1 ? snapshot.promise : Promise.resolve(latest)),
    });
    applyAutomationListEvent(
      client,
      type === "automation.upserted"
        ? { type, automation: current }
        : { type, automationId: automation.id },
    );
    snapshot.resolve([automation]);
    await expect(pending).resolves.toEqual(latest);
    expect(reads).toBe(2);
    expect(client.getQueryData<Automation[]>(automationQueries.listKey())).toEqual(latest);
  },
);

function createClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}

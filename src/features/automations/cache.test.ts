import { expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Automation } from "./model";
import { automationQueries } from "./queries";
import cache from "./cache";

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

test("events maintain an ordered, idempotent catalog", () => {
  const client = createClient();
  const key = automationQueries.list.queryKey;
  client.setQueryData(key, []);
  const newer = { ...automation, id: "newer", updatedAt: "2026-01-02T00:00:00.000Z" };
  for (const item of [newer, automation, { ...newer }]) {
    cache.applyEvent(client, { type: "automation.upserted", automation: item });
  }
  expect(client.getQueryData<Automation[]>(key)).toEqual([newer, automation]);
  for (const id of [automation.id, automation.id, "missing"]) {
    cache.applyEvent(client, { type: "automation.deleted", automationId: id });
  }
  expect(client.getQueryData<Automation[]>(key)).toEqual([newer]);
});

function createClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}

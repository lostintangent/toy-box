import { expect, test } from "bun:test";
import type { Session } from "../../model";
import { filterSessionList } from "./sessionFilters";

const session = (id: string, provider: string, modified: number): Session => ({
  id,
  provider: { id: provider },
  title: `${provider} session`,
  createdAt: new Date(0),
  updatedAt: new Date(modified),
});
const filters = { showExternalSessions: true, hiddenProviders: [], query: "" };

test("provider and source filters compose without changing the catalog", () => {
  const sessions = [
    session("11111111-1111-4111-8111-111111111111", "copilot", 1),
    session("22222222-2222-4222-8222-222222222222", "codex", 2),
    session("codex:external", "codex", 3),
  ];
  expect(
    filterSessionList(sessions, {
      ...filters,
      showExternalSessions: false,
      hiddenProviders: ["copilot"],
      query: " CODEX ",
    }).map(({ id }) => id),
  ).toEqual(["22222222-2222-4222-8222-222222222222"]);
  expect(
    filterSessionList(sessions, { ...filters, hiddenProviders: ["codex", "copilot"] }),
  ).toEqual([]);
  expect(sessions.map(({ id }) => id)).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "codex:external",
  ]);
});

test("matching sessions remain reachable beyond fifty newer sessions from another provider", () => {
  const older = session("11111111-1111-4111-8111-111111111111", "copilot", 0);
  const sessions = [
    older,
    ...Array.from({ length: 60 }, (_, i) => session(`codex:${i}`, "codex", i + 1)),
  ];
  expect(filterSessionList(sessions, { ...filters, hiddenProviders: ["codex"] })).toEqual([older]);
  expect(filterSessionList(sessions, filters)).toHaveLength(50);
  expect(filterSessionList(sessions, filters)[0]?.id).toBe("codex:59");
});

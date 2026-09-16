import { expect, test } from "bun:test";
import type { SessionMetadata } from "../../model";
import { filterSessionList } from "./sessionFilters";

const session = (sessionId: string, provider: string, modified: number): SessionMetadata => ({
  sessionId,
  provider,
  title: `${provider} session`,
  startTime: new Date(0),
  modifiedTime: new Date(modified),
});
const filters = { showExternalSessions: true, hiddenProviders: [], query: "" };

test("provider and source filters compose without changing the catalog", () => {
  const sessions = [
    session("toy-box-copilot", "copilot", 1),
    session("toy-box-codex", "codex", 2),
    session("codex:external", "codex", 3),
  ];
  expect(
    filterSessionList(sessions, {
      ...filters,
      showExternalSessions: false,
      hiddenProviders: ["copilot"],
      query: " CODEX ",
    }).map(({ sessionId }) => sessionId),
  ).toEqual(["toy-box-codex"]);
  expect(
    filterSessionList(sessions, { ...filters, hiddenProviders: ["codex", "copilot"] }),
  ).toEqual([]);
  expect(sessions.map(({ sessionId }) => sessionId)).toEqual([
    "toy-box-copilot",
    "toy-box-codex",
    "codex:external",
  ]);
});

test("matching sessions remain reachable beyond fifty newer sessions from another provider", () => {
  const older = session("toy-box-older", "copilot", 0);
  const sessions = [
    older,
    ...Array.from({ length: 60 }, (_, i) => session(`codex:${i}`, "codex", i + 1)),
  ];
  expect(filterSessionList(sessions, { ...filters, hiddenProviders: ["codex"] })).toEqual([older]);
  expect(filterSessionList(sessions, filters)).toHaveLength(50);
  expect(filterSessionList(sessions, filters)[0]?.sessionId).toBe("codex:59");
});

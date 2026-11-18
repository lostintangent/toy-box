import { expect, test } from "bun:test";
import { formatWakeCountdown } from "./AgentItem";

test.each([
  [38 * 60_000 + 1, "39m"],
  [60 * 60_000, "1h"],
  [81 * 60_000, "1h 21m"],
  [0, "Due"],
  [-5 * 60_000, "Due"],
])("a wake %ims away counts down as %s, like the Mac app", (milliseconds, expected) => {
  expect(formatWakeCountdown(milliseconds)).toBe(expected);
});

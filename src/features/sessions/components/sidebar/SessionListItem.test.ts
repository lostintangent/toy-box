import { expect, test } from "bun:test";
import { formatRunningTime } from "./SessionListItem";

const minutes = (count: number) => count * 60_000;

test("counts whole elapsed seconds for its first minute", () => {
  expect(formatRunningTime(0)).toBe("Running 0s");
  expect(formatRunningTime(12_999)).toBe("Running 12s");
  expect(formatRunningTime(minutes(1) - 1)).toBe("Running 59s");
});

test("counts whole elapsed minutes", () => {
  expect(formatRunningTime(minutes(1))).toBe("Running 1m");
  expect(formatRunningTime(minutes(12) + 59_999)).toBe("Running 12m");
});

test("drops the minutes on a whole hour", () => {
  expect(formatRunningTime(minutes(60))).toBe("Running 1h");
});

test("combines hours with their remaining minutes", () => {
  expect(formatRunningTime(minutes(65))).toBe("Running 1h 5m");
});

test("clamps clock skew to zero seconds", () => {
  expect(formatRunningTime(-minutes(5))).toBe("Running 0s");
});

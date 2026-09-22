import { describe, expect, test } from "bun:test";
import { cronToSchedule, scheduleToCron } from "./cron";

describe("automation schedules", () => {
  test.each([
    ["5 9 * * 1,3,5", "daily"],
    ["15 14 * * 2", "daily"],
    ["0 * * * *", "interval"],
    ["0 */6 * * 1,2,3,4,5", "interval"],
    ["0 */24 * * *", "interval"],
  ] as const)("round trips %s through %s editing", (cron, mode) => {
    const schedule = cronToSchedule(cron);
    expect(schedule.mode).toBe(mode);
    expect(scheduleToCron(schedule)).toBe(cron);
  });

  test("parses a time and deduplicates weekday names and Sunday aliases", () => {
    const schedule = cronToSchedule("5 9 * * mon,wed,7,0,mon");
    expect(schedule.time).toBe("09:05");
    expect(schedule.daysOfWeek).toEqual([0, 1, 3]);
    expect(scheduleToCron(schedule)).toBe("5 9 * * 0,1,3");
  });

  test("only serializes the selected mode's inputs", () => {
    const daily = cronToSchedule("35 14 * * 1,3,5");
    const interval = { ...daily, mode: "interval" as const, intervalHours: 6 };
    expect(scheduleToCron(interval)).toBe("0 */6 * * 1,3,5");
    expect(scheduleToCron({ ...interval, mode: "daily" })).toBe("35 14 * * 1,3,5");
    expect(scheduleToCron({ ...interval, mode: "cron", cron: "*/5 * * * *" })).toBe("*/5 * * * *");
  });

  test.each([
    "*/5 * * * *",
    "0 9 1 * *",
    "15 */4 * * *",
    "0 9 * * constructor",
    "60 9 * * *",
    "0 24 * * *",
    "0 */25 * * *",
    "0 9 * * 8",
    "",
  ])("preserves advanced or unfinished cron %s for raw editing", (cron) => {
    const schedule = cronToSchedule(cron);
    expect(schedule.mode).toBe("cron");
    expect(scheduleToCron(schedule)).toBe(cron);
  });
});

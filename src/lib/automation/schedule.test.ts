import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SIMPLE_SCHEDULE,
  cronToSimpleSchedule,
  normalizeSimpleSchedule,
  simpleScheduleToCron,
} from "./schedule";

describe("automation simple schedule helpers", () => {
  test("serializes daily schedule with weekday list", () => {
    const cron = simpleScheduleToCron({
      ...DEFAULT_SIMPLE_SCHEDULE,
      kind: "daily",
      minute: 5,
      hour: 9,
      daysOfWeek: [1, 3, 5],
    });

    expect(cron).toBe("5 9 * * 1,3,5");
  });

  test("serializes interval schedule", () => {
    const cron = simpleScheduleToCron({
      ...DEFAULT_SIMPLE_SCHEDULE,
      kind: "interval",
      minute: 0,
      intervalHours: 6,
      daysOfWeek: [1, 2, 3, 4, 5],
    });

    expect(cron).toBe("0 */6 * * 1,2,3,4,5");
  });

  test("parses supported cron expressions", () => {
    expect(cronToSimpleSchedule("5 9 * * *")?.kind).toBe("daily");
    expect(cronToSimpleSchedule("0 * * * *")?.kind).toBe("interval");
    expect(cronToSimpleSchedule("0 */4 * * 1,3,5")?.kind).toBe("interval");
    expect(cronToSimpleSchedule("15 14 * * 2")?.kind).toBe("daily");
  });

  test("parses weekday names and sunday alias", () => {
    expect(cronToSimpleSchedule("0 9 * * mon,wed")?.daysOfWeek).toEqual([1, 3]);
    expect(cronToSimpleSchedule("0 9 * * 7")?.daysOfWeek).toEqual([0]);
  });

  test("returns null for unsupported advanced cron syntax", () => {
    expect(cronToSimpleSchedule("*/5 * * * *")).toBeNull();
    expect(cronToSimpleSchedule("0 9 1 * *")).toBeNull();
    expect(cronToSimpleSchedule("15 */4 * * *")).toBeNull();
  });

  test("normalizes simple schedule bounds", () => {
    expect(
      normalizeSimpleSchedule({
        ...DEFAULT_SIMPLE_SCHEDULE,
        minute: -10,
        hour: 30,
        intervalHours: 50,
        daysOfWeek: [9, 3, -1, 3],
      }),
    ).toEqual({
      ...DEFAULT_SIMPLE_SCHEDULE,
      minute: 0,
      hour: 23,
      intervalHours: 24,
      daysOfWeek: [0, 3, 6],
    });
  });
});

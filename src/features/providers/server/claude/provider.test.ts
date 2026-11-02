import { expect, test } from "bun:test";
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { toSubscription } from "./provider";

const usage = (value: Partial<SDKControlGetUsageResponse>) => value as SDKControlGetUsageResponse;

test("a subscription names its plan and each window it meters, including per-model windows", () => {
  const fiveHour = "2026-10-17T04:09:59.662146+00:00";
  const weekly = "2026-10-21T00:59:59.662165+00:00";

  expect(
    toSubscription(
      usage({
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 52, resets_at: fiveHour },
          seven_day: { utilization: 5, resets_at: weekly },
          seven_day_opus: null,
          seven_day_sonnet: { utilization: null, resets_at: null },
          model_scoped: [{ display_name: "Fable", utilization: 0, resets_at: weekly }],
        },
      }),
    ),
  ).toEqual({
    plan: "max",
    limits: [
      { name: "5-hour", usedPercent: 52, resetsAt: Date.parse(fiveHour) },
      { name: "Weekly", usedPercent: 5, resetsAt: Date.parse(weekly) },
      { name: "Weekly Fable", usedPercent: 0, resetsAt: Date.parse(weekly) },
    ],
  });
});

test("a window with no reset time isn't metered for the plan", () => {
  const weekly = "2026-10-21T00:59:59.662165+00:00";

  expect(
    toSubscription(
      usage({
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 0, resets_at: null },
          seven_day: { utilization: 5, resets_at: weekly },
          seven_day_opus: null,
          seven_day_sonnet: null,
          model_scoped: [],
        },
      }),
    )?.limits,
  ).toEqual([{ name: "Weekly", usedPercent: 5, resetsAt: Date.parse(weekly) }]);
});

test("an account using an API key has no subscription", () => {
  expect(
    toSubscription(
      usage({ subscription_type: null, rate_limits_available: false, rate_limits: null }),
    ),
  ).toBeUndefined();
});

import { expect, onTestFinished, test } from "bun:test";
import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProvider, toSubscription } from "./provider";

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

test("deleting a history that is already gone resolves, and other failures propagate", async () => {
  const configDirectory = await mkdtemp(join(tmpdir(), "toy-box-claude-"));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDirectory;
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    await rm(configDirectory, { recursive: true, force: true });
  });
  const nativeId = crypto.randomUUID();
  const transcript = join(configDirectory, "projects", "-project", `${nativeId}.jsonl`);
  await Bun.write(transcript, Bun.file(new URL("./transcript.fixture.jsonl", import.meta.url)));

  await claudeProvider.delete(nativeId);
  await claudeProvider.delete(nativeId);
  expect(await Bun.file(transcript).exists()).toBe(false);
  await expect(claudeProvider.delete("not-a-session-id")).rejects.toThrow("Invalid sessionId");
});

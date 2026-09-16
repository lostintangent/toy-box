import { expect, test } from "bun:test";
import { toSdkSessionModelOptions, toSdkSetModelOptions } from "./modelConfiguration";

test("casts open option strings only when building SDK commands", () => {
  const configuration = {
    provider: "copilot",
    name: "gpt-5",
    reasoningEffort: "max",
    contextTier: "future_tier",
  };

  expect(toSdkSetModelOptions(configuration) as unknown).toEqual({
    reasoningEffort: "max",
    contextTier: "future_tier",
  });
  expect(toSdkSessionModelOptions(configuration) as unknown).toEqual({
    model: "gpt-5",
    reasoningEffort: "max",
    contextTier: "future_tier",
  });
});

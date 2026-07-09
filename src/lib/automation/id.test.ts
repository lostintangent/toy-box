import { describe, expect, test } from "bun:test";
import { createAutomationId, isAutomationId } from "./id";

describe("automation IDs", () => {
  test("creates IDs in the automation session namespace", () => {
    const automationId = createAutomationId();

    expect(automationId).toStartWith("toy-box-auto-");
    expect(isAutomationId(automationId)).toBe(true);
  });

  test("rejects IDs outside the automation namespace", () => {
    expect(isAutomationId("toy-box-abc")).toBe(false);
    expect(isAutomationId("toy-box-auto-not-a-uuid")).toBe(false);
  });
});

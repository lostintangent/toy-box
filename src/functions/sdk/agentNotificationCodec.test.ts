import { describe, expect, test } from "bun:test";
import {
  decodeSdkAgentNotification,
  encodeSdkAgentNotification,
  SDK_AGENT_NOTIFICATION_INSTRUCTIONS,
} from "./agentNotificationCodec";

describe("SDK agent notification codec", () => {
  test("round-trips notification markers", () => {
    const notification = { type: "artifact_edited", path: "/tmp/session/plan.md" } as const;

    expect(decodeSdkAgentNotification(encodeSdkAgentNotification(notification))).toEqual(
      notification,
    );
  });

  test("rejects non-marker and invalid marker content", () => {
    expect(decodeSdkAgentNotification("hello")).toBeUndefined();
    expect(
      decodeSdkAgentNotification("<toybox-notification>{bad}</toybox-notification>"),
    ).toBeUndefined();
    expect(
      decodeSdkAgentNotification(
        '<toybox-notification>{"type":"artifact_edited","path":""}</toybox-notification>',
      ),
    ).toBeUndefined();
  });

  test("keeps marker instructions at the SDK transport boundary", () => {
    expect(SDK_AGENT_NOTIFICATION_INSTRUCTIONS).toContain("<toybox-notification>");
    expect(SDK_AGENT_NOTIFICATION_INSTRUCTIONS).toContain("- artifact_edited:");
  });
});

import { describe, expect, test } from "bun:test";
import type { SessionCanvas } from "@/types";
import {
  resolveLinkedPanePublishState,
  resolveSessionOpenAction,
  shouldLoadSessionSnapshot,
} from "./policy";

describe("session pane open policy", () => {
  test.each([
    {
      name: "attaches when the session is running",
      input: {
        isSessionRunning: true,
        isSessionActive: false,
        hasQueuedMessages: false,
        isSessionUnread: false,
        unreadCatchupDone: false,
      },
      expected: "attach-stream",
    },
    {
      name: "attaches when the session snapshot is active",
      input: {
        isSessionRunning: false,
        isSessionActive: true,
        hasQueuedMessages: false,
        isSessionUnread: false,
        unreadCatchupDone: false,
      },
      expected: "attach-stream",
    },
    {
      name: "attaches when queued messages need draining",
      input: {
        isSessionRunning: false,
        isSessionActive: false,
        hasQueuedMessages: true,
        isSessionUnread: false,
        unreadCatchupDone: false,
      },
      expected: "attach-stream",
    },
    {
      name: "catches up unread idle sessions once",
      input: {
        isSessionRunning: false,
        isSessionActive: false,
        hasQueuedMessages: false,
        isSessionUnread: true,
        unreadCatchupDone: false,
      },
      expected: "catch-up-unread",
    },
    {
      name: "does nothing after unread catch-up has run",
      input: {
        isSessionRunning: false,
        isSessionActive: false,
        hasQueuedMessages: false,
        isSessionUnread: true,
        unreadCatchupDone: true,
      },
      expected: "none",
    },
    {
      name: "does nothing for idle read sessions",
      input: {
        isSessionRunning: false,
        isSessionActive: false,
        hasQueuedMessages: false,
        isSessionUnread: false,
        unreadCatchupDone: false,
      },
      expected: "none",
    },
  ] as const)("$name", ({ input, expected }) => {
    expect(resolveSessionOpenAction(input)).toBe(expected);
  });
});

describe("linked pane publish policy", () => {
  const canvas: SessionCanvas = {
    key: "canvas-instance",
    canvasId: "canvas",
    instanceId: "instance",
    title: "Canvas",
    url: "https://example.test/canvas",
    revision: 0,
  };

  test("publishes an empty pane state for drafts", () => {
    expect(
      resolveLinkedPanePublishState({
        isDraft: true,
        isStreaming: false,
        linkedSessionIds: ["live-child"],
        canvases: [canvas],
        hasSessionSnapshot: false,
        sessionSnapshot: undefined,
      }),
    ).toEqual({ linkedSessionIds: [], canvases: [] });
  });

  test("publishes live reducer state while streaming", () => {
    expect(
      resolveLinkedPanePublishState({
        isDraft: false,
        isStreaming: true,
        linkedSessionIds: ["live-child"],
        canvases: [canvas],
        hasSessionSnapshot: false,
        sessionSnapshot: undefined,
      }),
    ).toEqual({ linkedSessionIds: ["live-child"], canvases: [canvas] });
  });

  test("waits for a session snapshot before publishing idle sessions", () => {
    expect(
      resolveLinkedPanePublishState({
        isDraft: false,
        isStreaming: false,
        linkedSessionIds: ["stale-live-child"],
        canvases: [canvas],
        hasSessionSnapshot: false,
        sessionSnapshot: undefined,
      }),
    ).toBeUndefined();
  });

  test("publishes session snapshot state for idle sessions", () => {
    expect(
      resolveLinkedPanePublishState({
        isDraft: false,
        isStreaming: false,
        linkedSessionIds: ["stale-live-child"],
        canvases: [canvas],
        hasSessionSnapshot: true,
        sessionSnapshot: {
          linkedSessionIds: ["snapshot-child"],
          canvases: [],
        },
      }),
    ).toEqual({ linkedSessionIds: ["snapshot-child"], canvases: [] });
  });
});

describe("session snapshot load policy", () => {
  test.each([
    {
      name: "queries resolved idle persisted sessions",
      input: {
        isDraft: false,
        isStreaming: false,
        isDraftStatusLoading: false,
      },
      expected: true,
    },
    {
      name: "waits for draft status before querying",
      input: {
        isDraft: false,
        isStreaming: false,
        isDraftStatusLoading: true,
      },
      expected: false,
    },
    {
      name: "skips drafts",
      input: {
        isDraft: true,
        isStreaming: false,
        isDraftStatusLoading: false,
      },
      expected: false,
    },
    {
      name: "skips streaming sessions",
      input: {
        isDraft: false,
        isStreaming: true,
        isDraftStatusLoading: false,
      },
      expected: false,
    },
  ] as const)("$name", ({ input, expected }) => {
    expect(shouldLoadSessionSnapshot(input)).toBe(expected);
  });
});

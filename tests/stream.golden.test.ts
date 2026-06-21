import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { describe, expect, mock, test } from "bun:test";
import type { SessionEvent } from "@/types";
import { loadSessionFixture } from "./helpers";

// Golden replay of the full stream lifetime: real v1 CLI events from the
// fixture drive a SessionStream through two turns — explicit start, fixture
// replay, queueing a follow-up, the idle→drain handoff, and the final
// idle→close teardown. The projector/reducer goldens lock the data pipeline;
// this locks the runtime around it: event sequencing (eventId/turnId
// decoration), buffering, broadcast ordering, and teardown.
//
// Nondeterministic ids (Date.now-seeded eventIds, timestamped turnIds) are
// normalized to stable ordinals before asserting.
//
// NOTE: mock.module persists for the remainder of the bun test process, so
// each mock covers the module's FULL export surface — partial mocks poison
// later test files that import the missing exports.

const sideEffects: string[] = [];
const unused = () => {
  throw new Error("not used in stream golden replay");
};

function sdkEvent(event: unknown): SdkSessionEvent {
  return event as SdkSessionEvent;
}

mock.module("@/functions/state/sessionCache", () => ({
  createSession: unused,
  getOrResumeSession: unused,
  getCachedOrResumeSession: unused,
  evictCachedSession: () => {},
  hasCachedSession: () => false,
  deleteSession: unused,
}));
mock.module("@/functions/state/unread", () => ({
  markSessionRead: (id: string) => sideEffects.push(`read:${id}`),
  markSessionUnread: (id: string) => sideEffects.push(`unread:${id}`),
  getUnreadSessionIds: () => [],
  deleteUnreadState: () => false,
}));
mock.module("@/functions/runtime/broadcast", () => ({
  emitSessionRunning: (id: string) => sideEffects.push(`running:${id}`),
  emitSessionIdle: (id: string) => sideEffects.push(`idle:${id}`),
  emitSessionTouched: (id: string, opts?: { summary?: string }) =>
    sideEffects.push(`touched:${id}:${opts?.summary ?? ""}`),
  updateSessionSummary: (id: string, summary: string) =>
    sideEffects.push(`summary:${id}:${summary}`),
  emitSessionsUpdate: () => {},
  emitSessionUpsert: () => {},
  emitSessionDelete: () => {},
  emitSessionUnread: () => {},
  emitSessionRead: () => {},
  subscribeSessionsUpdates: () => () => {},
}));

const { SessionStream } = await import("@/functions/runtime/stream");

const SESSION_ID = "golden-stream";

describe("stream golden replay", () => {
  test("two-turn lifetime: fixture replay, queue drain, and close", async () => {
    // ── Normalization for nondeterministic ids ─────────────────────────
    let baseEventId: number | undefined;
    const turnIds = new Map<string, string>();
    const normalize = (event: SessionEvent | null): unknown => {
      if (event === null) return "<<STREAM-CLOSED>>";
      const e = { ...event } as Record<string, unknown>;
      if (typeof e.eventId === "number") {
        baseEventId ??= e.eventId;
        e.eventId = e.eventId - baseEventId;
      }
      if (typeof e.turnId === "string") {
        if (!turnIds.has(e.turnId)) turnIds.set(e.turnId, `turn-${turnIds.size}`);
        e.turnId = turnIds.get(e.turnId);
      }
      return e;
    };

    const sdkCalls: unknown[] = [];
    let sdkHandler: ((event: SdkSessionEvent) => void) | undefined;
    const fakeSession = {
      on: (handler: (event: SdkSessionEvent) => void) => {
        sdkHandler = handler;
        return () => sideEffects.push("sdk:unsubscribed");
      },
      send: async (message: unknown) => {
        sdkCalls.push({ send: message });
      },
      setModel: async (model: string, options: unknown) => {
        sdkCalls.push({ setModel: [model, options] });
      },
    } as unknown as CopilotSession;

    const stream = SessionStream.getOrCreate(SESSION_ID, fakeSession, {
      modelConfiguration: { model: "gpt-5.5" },
    });
    const received: unknown[] = [];
    stream.subscribe((event) => received.push(normalize(event)));

    // Turn 1: explicit start + full fixture replay through the SDK listener.
    stream.startTurn("kick off the reviews", "client-1");
    for (const event of await loadSessionFixture("subagents")) {
      sdkHandler!(event);
    }
    sdkHandler!(
      sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Wrapping up." } }),
    );

    // Queue a follow-up, then end turn 1 → drain dequeues and sends turn 2.
    stream.addQueuedMessage({ id: "queued-1", role: "user", content: "now fix the findings" });
    sdkHandler!(sdkEvent({ type: "session.idle", data: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Turn 2 streams, then idles with an empty queue → close.
    sdkHandler!(sdkEvent({ type: "assistant.turn_start", data: {} }));
    sdkHandler!(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "On it." } }));
    sideEffects.push("--- pre-close ---");
    sdkHandler!(sdkEvent({ type: "session.idle", data: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // ── Invariants ─────────────────────────────────────────────────────
    // The drain sent exactly the queued prompt to the SDK.
    expect(sdkCalls).toEqual([
      { send: { prompt: "now fix the findings", attachments: undefined } },
    ]);
    // Teardown sequence: unread update, idle announcement, end-of-stream
    // marker to subscribers, SDK unsubscribe — in that order.
    expect(sideEffects.slice(sideEffects.indexOf("--- pre-close ---") + 1)).toEqual([
      `read:${SESSION_ID}`,
      `idle:${SESSION_ID}`,
      "sdk:unsubscribed",
    ]);
    expect(received.at(-1)).toBe("<<STREAM-CLOSED>>");
    expect(SessionStream.isRunning(SESSION_ID)).toBe(false);

    // Live mode converges on the same conversation shape as history replay:
    // every subagent's work grouped under its agent call.
    const state = stream.getSessionState();
    const agents = state.messages.flatMap((m) =>
      m.role === "assistant" ? (m.toolCalls ?? []).filter((tc) => tc.name === "agent") : [],
    );
    expect(agents).toHaveLength(7);
    const childCounts = agents
      .map((tc) => tc.agent?.toolCalls?.length ?? 0)
      .filter((n) => n > 0)
      .sort();
    expect(childCounts).toEqual([3, 4]);

    // ── Golden shape ───────────────────────────────────────────────────
    expect({ received, sideEffects }).toMatchSnapshot();
    expect({
      ...state,
      pendingToolCalls: [...state.pendingToolCalls.entries()],
      lastSeenEventId:
        state.lastSeenEventId !== undefined && baseEventId !== undefined
          ? state.lastSeenEventId - baseEventId
          : state.lastSeenEventId,
      activeTurnId: state.activeTurnId ? turnIds.get(state.activeTurnId) : state.activeTurnId,
    }).toMatchSnapshot();
  });
});

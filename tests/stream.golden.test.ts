import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { afterAll, describe, expect, mock, test } from "bun:test";
import type { SessionEvent, SessionMetadataUpdate, WorkspaceEvent } from "@/types";
import {
  sessionSeedFromSnapshot,
  toSessionSnapshot,
  type Session,
} from "@/lib/session/sessionReducer";
import { loadSessionFixture } from "./helpers";
import * as realSessionRegistry from "@/functions/state/session/registry";
import * as realBroadcast from "@/functions/runtime/broadcast";
import * as realWorkspaceState from "@/functions/state/workspace";

// Golden replay of the full stream lifetime: real v1 CLI events from the
// fixture drive a SessionStream through two turns — explicit start, fixture
// replay, queueing a follow-up, the idle→drain handoff, and the final
// idle→close teardown. The projector/reducer goldens lock the data pipeline;
// this locks the runtime around it: event sequencing (eventId/turnId
// decoration), buffering, global broadcast ordering, and teardown.
//
// Nondeterministic ids (Date.now-seeded eventIds, timestamped turnIds) are
// normalized to stable ordinals before asserting.
//
// Module mocks cover each module's full surface and are restored after this
// suite so the golden harness cannot alter later integration tests.

const sideEffects: string[] = [];
const workspaceEventListeners = new Set<(event: WorkspaceEvent) => void>();
const realSessionRegistryExports = { ...realSessionRegistry };
const realBroadcastExports = { ...realBroadcast };
const realWorkspaceStateExports = { ...realWorkspaceState };
const unused = () => {
  throw new Error("not used in stream golden replay");
};

function emitMockWorkspaceEvent(event: WorkspaceEvent): void {
  for (const listener of workspaceEventListeners) {
    listener(event);
  }
}

function sdkEvent(event: unknown): SdkSessionEvent {
  return event as SdkSessionEvent;
}

mock.module("@/functions/state/session/registry", () => ({
  createSession: unused,
  getSession: unused,
  withSession: unused,
  evictCachedSession: () => {},
  evictCachedSessionIfStale: () => false,
  deleteSession: unused,
  deleteSessionIfExists: unused,
}));
mock.module("@/functions/runtime/broadcast", () => ({
  updateSessionName: (sessionId: string, name: string) => {
    sideEffects.push(`summary:${sessionId}:${name}`);
    emitMockWorkspaceEvent({
      type: "session.upserted",
      session: {
        sessionId,
        modifiedTime: new Date().toISOString(),
        summary: name,
      },
    });
  },
  emitWorkspaceEvent: emitMockWorkspaceEvent,
  broadcast: (event: WorkspaceEvent | null) => {
    if (event) emitMockWorkspaceEvent(event);
  },
  emitSessionUpsert: (session: SessionMetadataUpdate) =>
    emitMockWorkspaceEvent({ type: "session.upserted", session }),
  emitSessionDelete: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.deleted", sessionId }),
  subscribeWorkspaceEvents: (listener: (event: WorkspaceEvent) => void) => {
    workspaceEventListeners.add(listener);
    return () => {
      workspaceEventListeners.delete(listener);
    };
  },
  emitAutomationEvent: () => {},
  subscribeAutomationEvents: () => () => {},
}));
mock.module("@/functions/state/workspace", () => ({
  ...realWorkspaceStateExports,
  setSessionStatus: (sessionId: string, status: "creating" | "running" | "idle" | "unread") => {
    sideEffects.push(`${status}:${sessionId}`);
    emitMockWorkspaceEvent({ type: `session.${status}`, sessionId });
  },
  clearDraftPrompt: () => {},
}));

afterAll(() => {
  mock.module("@/functions/state/session/registry", () => realSessionRegistryExports);
  mock.module("@/functions/runtime/broadcast", () => realBroadcastExports);
  mock.module("@/functions/state/workspace", () => realWorkspaceStateExports);
});

const { SessionStream } = await import("@/functions/runtime/stream");

const SESSION_ID = "golden-stream";

describe("stream golden replay", () => {
  test("two-turn lifetime: fixture replay, queue drain, and close", async () => {
    // ── Normalization for nondeterministic ids ─────────────────────────
    let baseEventId: number | undefined;
    const turnIds = new Map<string, string>();
    const normalize = (event: SessionEvent): unknown => {
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
      model: { name: "gpt-5.5" },
    });
    const received: unknown[] = [];
    const events = stream.subscribe();
    const collector = (async () => {
      for await (const event of events) {
        received.push(normalize(event));
      }
      received.push("<<STREAM-CLOSED>>");
    })();

    // Turn 1: explicit start + full fixture replay through the SDK listener.
    await stream.deliver({ id: "client-1", role: "user", content: "kick off the reviews" });
    for (const event of await loadSessionFixture("subagents")) {
      sdkHandler!(event);
    }
    sdkHandler!(
      sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Wrapping up." } }),
    );

    // Queue a follow-up, then end turn 1 → drain dequeues and sends turn 2.
    await stream.deliver({ id: "queued-1", role: "user", content: "now fix the findings" });
    sdkHandler!(sdkEvent({ type: "session.idle", data: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Turn 2 streams, then idles with an empty queue → close.
    sdkHandler!(sdkEvent({ type: "assistant.turn_start", data: {} }));
    sdkHandler!(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "On it." } }));
    sideEffects.push("--- pre-close ---");
    sdkHandler!(sdkEvent({ type: "session.idle", data: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await collector;

    // ── Invariants ─────────────────────────────────────────────────────
    // Each turn sent exactly its prompt to the SDK: the explicit start,
    // then the drained queue prompt.
    expect(sdkCalls).toEqual([
      { send: { prompt: "kick off the reviews", attachments: undefined } },
      { send: { prompt: "now fix the findings", attachments: undefined } },
    ]);
    // Teardown sequence: idle announcement, end-of-stream marker to subscribers,
    // SDK unsubscribe — in that order. The workspace read action is silent when
    // the session was not unread.
    expect(sideEffects.slice(sideEffects.indexOf("--- pre-close ---") + 1)).toEqual([
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

  test("a snapshot-seeded stream converges with an uninterrupted stream across turns", async () => {
    // The same two turns travel two roads: one stream that lives through
    // both, and a stream that closes cleanly after turn 1 (the snapshot capture
    // point) and is reborn seeded from its snapshot — the reply-to-idle-
    // session path. Both must reduce to identical session state.
    const fixture = await loadSessionFixture("subagents");

    type DrivenStream = {
      stream: ReturnType<typeof SessionStream.getOrCreate>;
      emit: (event: SdkSessionEvent) => void;
    };

    const driveStream = (sessionId: string, initialState?: Partial<Session>): DrivenStream => {
      let handler: ((event: SdkSessionEvent) => void) | undefined;
      const fakeSession = {
        on: (h: (event: SdkSessionEvent) => void) => {
          handler = h;
          return () => {};
        },
        send: async () => {},
        setModel: async () => {},
      } as unknown as CopilotSession;

      return {
        stream: SessionStream.getOrCreate(sessionId, fakeSession, initialState),
        emit: (event) => handler!(event),
      };
    };

    const runTurnOne = async ({ stream, emit }: DrivenStream) => {
      await stream.deliver({ id: "client-1", role: "user", content: "kick off the reviews" });
      for (const event of fixture) {
        emit(event);
      }
      emit(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Wrapping up." } }));
    };

    const runTurnTwo = async ({ stream, emit }: DrivenStream) => {
      const disposition = await stream.deliver({
        id: "queued-1",
        role: "user",
        content: "now fix the findings",
      });
      if (disposition === "queued") {
        emit(sdkEvent({ type: "session.idle", data: {} }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      emit(sdkEvent({ type: "assistant.turn_start", data: {} }));
      emit(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "On it." } }));
      emit(sdkEvent({ type: "session.idle", data: {} }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    const comparable = (state: Session): unknown => ({
      ...state,
      pendingToolCalls: [...state.pendingToolCalls.entries()],
      lastSeenEventId: undefined,
      activeTurnId: undefined,
    });

    // Road 1: both turns on one uninterrupted stream.
    const uninterrupted = driveStream("golden-uninterrupted");
    await runTurnOne(uninterrupted);
    await runTurnTwo(uninterrupted);

    // Road 2: turn 1 closes cleanly, capturing the normalized final state.
    const interrupted = driveStream("golden-interrupted");
    await runTurnOne(interrupted);
    interrupted.emit(sdkEvent({ type: "session.idle", data: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(SessionStream.isRunning("golden-interrupted")).toBe(false);

    const capturedSnapshot = toSessionSnapshot(
      "golden-interrupted",
      interrupted.stream.getSessionState(),
    );

    // A new stream for the same session, seeded from the snapshot exactly as
    // delivery acquisition does on a cache hit, runs turn 2.
    const seeded = driveStream("golden-interrupted", sessionSeedFromSnapshot(capturedSnapshot));
    await runTurnTwo(seeded);

    expect(comparable(seeded.stream.getSessionState())).toEqual(
      comparable(uninterrupted.stream.getSessionState()),
    );
  });
});

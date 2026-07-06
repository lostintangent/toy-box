import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type {
  DraftPrompt,
  DraftSession,
  SessionEvent,
  SessionMetadataUpdate,
  WorkspaceEvent,
} from "@/types";
import {
  sessionSeedFromSnapshot,
  toSessionSnapshot,
  type Session,
} from "@/lib/session/sessionReducer";
import { loadSessionFixture } from "./helpers";

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
// NOTE: mock.module persists for the remainder of the bun test process, so
// each mock covers the module's FULL export surface — partial mocks poison
// later test files that import the missing exports.

const sideEffects: string[] = [];
const workspaceEventListeners = new Set<(event: WorkspaceEvent) => void>();
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

mock.module("@/functions/state/sessionRegistry", () => ({
  createSession: unused,
  getSession: unused,
  withSession: unused,
  evictCachedSession: () => {},
  evictCachedSessionIfStale: () => false,
  hasCachedSession: () => false,
  deleteSession: unused,
}));
mock.module("@/functions/runtime/broadcast", () => ({
  emitSessionRunning: (sessionId: string) => {
    sideEffects.push(`running:${sessionId}`);
    emitMockWorkspaceEvent({ type: "session.running", sessionId });
  },
  emitSessionIdle: (sessionId: string) => {
    sideEffects.push(`idle:${sessionId}`);
    emitMockWorkspaceEvent({ type: "session.idle", sessionId });
  },
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
  emitSessionUpsert: (session: SessionMetadataUpdate) =>
    emitMockWorkspaceEvent({ type: "session.upserted", session }),
  emitSessionDelete: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.deleted", sessionId }),
  emitSessionUnread: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.unread", sessionId }),
  emitSessionRead: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.read", sessionId }),
  emitDraftCreated: (draft: DraftSession) =>
    emitMockWorkspaceEvent({ type: "session.draft.created", draft }),
  emitDraftDiscarded: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.draft.discarded", sessionId }),
  emitSessionHyper: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.hyper.created", sessionId }),
  emitSessionPromoted: (sessionId: string) =>
    emitMockWorkspaceEvent({ type: "session.hyper.promoted", sessionId }),
  emitDraftPromptChanged: (sessionId: string, prompt: DraftPrompt) =>
    emitMockWorkspaceEvent({ type: "session.prompt.drafted", sessionId, prompt }),
  subscribeWorkspaceEvents: (listener: (event: WorkspaceEvent) => void) => {
    workspaceEventListeners.add(listener);
    return () => {
      workspaceEventListeners.delete(listener);
    };
  },
  emitAutomationsUpdate: () => {},
  subscribeAutomationsUpdates: () => () => {},
}));

const { SessionStream } = await import("@/functions/runtime/stream");
const { deleteUnreadState } = await import("@/functions/state/workspace");

const SESSION_ID = "golden-stream";

describe("stream golden replay", () => {
  test("two-turn lifetime: fixture replay, queue drain, and close", async () => {
    onTestFinished(() => {
      deleteUnreadState(SESSION_ID);
    });

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
      modelConfiguration: { model: "gpt-5.5" },
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
    await stream.startTurn({ id: "client-1", role: "user", content: "kick off the reviews" });
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
    onTestFinished(() => {
      deleteUnreadState("golden-uninterrupted");
      deleteUnreadState("golden-interrupted");
    });

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
      await stream.startTurn({ id: "client-1", role: "user", content: "kick off the reviews" });
      for (const event of fixture) {
        emit(event);
      }
      emit(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Wrapping up." } }));
    };

    const runTurnTwo = async ({ stream, emit }: DrivenStream) => {
      await stream.startTurn({ id: "queued-1", role: "user", content: "now fix the findings" });
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

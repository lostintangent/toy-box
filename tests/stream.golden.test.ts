import { connectCopilotSession, holdNativeEvents } from "@providers/server/copilot/connection";
import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { SessionEvent, SessionState } from "@sessions/model";
import { loadSessionFixture } from "./helpers";
import * as realSessionRegistry from "@sessions/server/state/registry";
import * as realBroadcast from "@workspace/server/events";

// Golden replay of the full execution lifetime: real v1 CLI events from the
// fixture drive a SessionExecution through two turns — explicit start, fixture
// replay, queueing a follow-up, the idle→drain handoff, and the final
// idle→finish teardown. The projector/reducer goldens lock the data pipeline;
// this locks the runtime around it: event sequencing, client ID correlation,
// buffering, global broadcast ordering, and teardown.
//
// Nondeterministic Date.now-seeded eventIds are normalized to stable ordinals
// before asserting.
//
// Module mocks cover each module's full surface and are restored after this
// suite so the golden harness cannot alter later integration tests.

const sideEffects: string[] = [];
const workspaceEventListeners = new Set<(event: WorkspaceEvent) => void>();
const realSessionRegistryExports = { ...realSessionRegistry };
const realBroadcastExports = { ...realBroadcast };
const unused = () => {
  throw new Error("not used in stream golden replay");
};
const settle = () => Bun.sleep(0);
const INITIAL_PROMPT = "kick off the reviews";

function emitMockWorkspaceEvent(event: WorkspaceEvent): void {
  for (const listener of workspaceEventListeners) {
    listener(event);
  }
}

function sdkEvent(event: unknown): SdkSessionEvent {
  return event as SdkSessionEvent;
}

function identifyUserMessage(event: SdkSessionEvent, clientTurnId: string): SdkSessionEvent {
  return event.type === "user.message"
    ? sdkEvent({ ...event, data: { ...event.data, clientTurnId } })
    : event;
}

mock.module("@sessions/server/state/registry", () => ({
  createSession: unused,
  getSession: unused,
  withSession: unused,
  evictCachedSession: () => {},
  evictCachedSessionIfStale: () => false,
  deleteSession: unused,
  deleteSessionIfExists: unused,
}));
mock.module("@workspace/server/events", () => ({
  getWorkspaceRevision: unused,
  broadcast: (event: WorkspaceEvent) => {
    if (event.type === "session.upserted" && event.session.title !== undefined) {
      sideEffects.push(`title:${event.session.id}:${event.session.title}`);
    }
    if (
      event.type === "session.running" ||
      event.type === "session.waiting" ||
      event.type === "session.background" ||
      event.type === "session.idle" ||
      event.type === "session.unread"
    ) {
      sideEffects.push(`${event.type.slice("session.".length)}:${event.sessionId}`);
    }
    emitMockWorkspaceEvent(event);
  },
  subscribeWorkspaceEvents: (listener: (event: WorkspaceEvent) => void) => {
    workspaceEventListeners.add(listener);
    return () => {
      workspaceEventListeners.delete(listener);
    };
  },
}));

afterAll(() => {
  mock.module("@sessions/server/state/registry", () => realSessionRegistryExports);
  mock.module("@workspace/server/events", () => realBroadcastExports);
});

beforeEach(() => {
  sideEffects.length = 0;
  workspaceEventListeners.clear();
});

const { SessionExecution } = await import("@sessions/server/runtime/sessionExecution");

const SESSION_ID = "golden-stream";

describe("stream golden replay", () => {
  test("two-turn lifetime: fixture replay, queue drain, and finish", async () => {
    // ── Normalization for nondeterministic ids ─────────────────────────
    let baseEventId: number | undefined;
    const normalize = (event: SessionEvent): unknown => {
      const e = { ...event } as Record<string, unknown>;
      if (typeof e.eventId === "number") {
        baseEventId ??= e.eventId;
        e.eventId = e.eventId - baseEventId;
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

    const execution = SessionExecution.getOrCreate(
      SESSION_ID,
      connectCopilotSession(fakeSession, holdNativeEvents()),
      {
        model: { provider: "copilot", name: "gpt-5.5" },
      },
    );
    const received: unknown[] = [];
    const events = execution.subscribe();
    const collector = (async () => {
      for await (const event of events) {
        received.push(normalize(event));
      }
      received.push("<<SUBSCRIPTION-DONE>>");
    })();

    // Turn 1: explicit start + full fixture replay through the SDK listener.
    await execution.deliver({ clientId: "client-1", role: "user", content: INITIAL_PROMPT });
    for (const event of await loadSessionFixture("subagents")) {
      sdkHandler!(identifyUserMessage(event, "client-1"));
    }
    sdkHandler!(
      sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Wrapping up." } }),
    );

    // Queue a follow-up, then end turn 1 so the runtime sends turn 2.
    await execution.deliver({
      clientId: "queued-1",
      role: "user",
      content: "now fix the findings",
    });
    sdkHandler!(sdkEvent({ type: "session.idle", data: {} }));
    await settle();

    // Turn 2 streams, then idles with an empty queue → finish.
    sdkHandler!(
      sdkEvent({
        type: "user.message",
        data: {
          clientTurnId: "queued-1",
          content: "now fix the findings",
          delivery: "idle",
        },
      }),
    );
    sdkHandler!(sdkEvent({ type: "assistant.turn_start", data: {} }));
    sdkHandler!(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "On it." } }));
    sideEffects.push("--- pre-finish ---");
    sdkHandler!(sdkEvent({ type: "session.idle", data: {} }));
    await settle();
    await collector;

    // ── Invariants ─────────────────────────────────────────────────────
    // Each turn sent exactly its prompt to the SDK: the explicit start,
    // then the drained queue prompt.
    expect(sdkCalls).toEqual([
      { send: { prompt: INITIAL_PROMPT, attachments: undefined, clientTurnId: "client-1" } },
      {
        send: { prompt: "now fix the findings", attachments: undefined, clientTurnId: "queued-1" },
      },
    ]);
    // Teardown sequence: unread announcement, end-of-stream marker to subscribers,
    // SDK unsubscribe — in that order. A watching client marks the turn read itself.
    expect(sideEffects.slice(sideEffects.indexOf("--- pre-finish ---") + 1)).toEqual([
      `unread:${SESSION_ID}`,
      "sdk:unsubscribed",
    ]);
    expect(received.at(-1)).toBe("<<SUBSCRIPTION-DONE>>");
    expect(SessionExecution.isRunning(SESSION_ID)).toBe(false);

    // The SDK input is authoritative: delivery itself emits no provisional
    // transcript event, and the later SDK event receives the client's ID.
    const firstUserEvent = received.find(
      (event): event is Record<string, unknown> =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "user_message",
    );
    expect(firstUserEvent).toMatchObject({ type: "user_message", clientId: "client-1" });
    expect(firstUserEvent?.content).not.toBe(INITIAL_PROMPT);

    // Live mode converges on the same conversation shape as history replay:
    // every subagent's work grouped under its agent call.
    const state = execution.getSessionState();
    const agents = state.messages.flatMap((m) =>
      m.role === "assistant" ? (m.toolCalls ?? []).filter((tc) => tc.name === "agent") : [],
    );
    expect(agents).toHaveLength(7);
    const childCounts = agents
      .map((tc) => tc.subagent?.toolCalls?.length ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    expect(childCounts).toEqual([3, 4]);

    // ── Golden shape ───────────────────────────────────────────────────
    expect({ received, sideEffects }).toMatchSnapshot();
    expect({
      ...state,
      lastSeenEventId:
        state.lastSeenEventId !== undefined && baseEventId !== undefined
          ? state.lastSeenEventId - baseEventId
          : state.lastSeenEventId,
    }).toMatchSnapshot();
  });

  test("a snapshot-seeded execution converges with an uninterrupted execution across turns", async () => {
    // The same two turns travel two roads: one execution that lives through
    // both, and an execution that finishes cleanly after turn 1 (the snapshot capture
    // point) and is reborn seeded from its snapshot — the reply-to-idle-
    // session path. Both must reduce to identical session state.
    const fixture = await loadSessionFixture("subagents");

    type DrivenExecution = {
      execution: ReturnType<typeof SessionExecution.getOrCreate>;
      emit: (event: SdkSessionEvent) => void;
    };

    const driveExecution = (
      sessionId: string,
      initialState?: Partial<SessionState>,
    ): DrivenExecution => {
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
        execution: SessionExecution.getOrCreate(
          sessionId,
          connectCopilotSession(fakeSession, holdNativeEvents()),
          initialState,
        ),
        emit: (event) => handler!(event),
      };
    };

    const runTurnOne = async ({ execution, emit }: DrivenExecution) => {
      await execution.deliver({ clientId: "client-1", role: "user", content: INITIAL_PROMPT });
      for (const event of fixture) {
        emit(identifyUserMessage(event, "client-1"));
      }
      emit(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Wrapping up." } }));
    };

    const runTurnTwo = async ({ execution, emit }: DrivenExecution) => {
      const disposition = await execution.deliver({
        clientId: "queued-1",
        role: "user",
        content: "now fix the findings",
      });
      if (disposition === "queued") {
        emit(sdkEvent({ type: "session.idle", data: {} }));
        await settle();
      }
      emit(
        sdkEvent({
          type: "user.message",
          data: {
            clientTurnId: "queued-1",
            content: "now fix the findings",
            delivery: "idle",
          },
        }),
      );
      emit(sdkEvent({ type: "assistant.turn_start", data: {} }));
      emit(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "On it." } }));
      emit(sdkEvent({ type: "session.idle", data: {} }));
      await settle();
    };

    const comparable = (state: SessionState): unknown => ({
      ...state,
      lastSeenEventId: undefined,
    });

    // Road 1: both turns on one uninterrupted execution.
    const uninterrupted = driveExecution("golden-uninterrupted");
    await runTurnOne(uninterrupted);
    await runTurnTwo(uninterrupted);

    // Road 2: turn 1 finishes cleanly, capturing the normalized final state.
    const interrupted = driveExecution("golden-interrupted");
    await runTurnOne(interrupted);
    interrupted.emit(sdkEvent({ type: "session.idle", data: {} }));
    await settle();
    expect(SessionExecution.isRunning("golden-interrupted")).toBe(false);

    const capturedSnapshot = interrupted.execution.getSessionState();
    const { lastSeenEventId: _lastSeenEventId, ...capturedState } = capturedSnapshot;

    // A new execution for the same session, seeded from the snapshot exactly as
    // delivery acquisition does on a cache hit, runs turn 2.
    const seeded = driveExecution("golden-interrupted", capturedState);
    await runTurnTwo(seeded);

    expect(comparable(seeded.execution.getSessionState())).toEqual(
      comparable(uninterrupted.execution.getSessionState()),
    );
  });
});

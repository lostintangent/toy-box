// History replay — owns persisted log → Session, end to end. A log is
// replayed through the SAME streaming projection (projector.ts) and the same
// reducer that live sessions use, so a reloaded transcript can never
// disagree with the one a client watched stream in.
//
// Only a thin adaptation layer lives here, because a persisted log differs
// from a live event stream in exactly three ways:
//
//   1. Committed messages. Logs store whole user/assistant messages where
//      live sessions stream deltas. Root messages project as committed
//      user_message/assistant_message events; agent-scoped assistant
//      messages nest under their agent tool call.
//   2. Lifecycle records. Logs carry the session model on session.start and
//      session.shutdown (live sessions emit session.model_change instead),
//      and older logs record the spawning agent as data.parentToolCallId
//      where current streams put agentId at the top level.
//   3. No in-flight progress. Turn/compaction status events describe live
//      progress, which a finished transcript doesn't have — they're dropped,
//      and a synthetic stream_end finalizes transient state instead.
//
// Everything else — tool lifecycles, subagent nesting, todo SQL translation,
// omitted/translated/deferred tool policy — flows through projector.ts
// untouched.

import type { Attachment, SessionEvent } from "@/types";
import {
  applySessionEvent,
  createInitialSession,
  type Session,
} from "@/lib/session/sessionReducer";
import { readAttachmentBlobs } from "./attachments";
import { readPath, readString, type SdkSessionEvent } from "./extractors";
import {
  createProjectionState,
  projectModelChanged,
  projectSdkEvent,
  type ProjectionState,
} from "./projector";

type AttachmentResolver = (
  event: SdkSessionEvent,
  index: number,
) => Promise<Attachment[] | undefined>;

type HistoryReplayContext = {
  /** Streaming projection state (tool call policies), shared across the log. */
  state: ProjectionState;
  /** Once-ever latch set by the first root user/assistant message — see the
   *  orphan gate in projectHistoryEvent. */
  hasVisibleRootTurn: boolean;
};

// ============================================================================
// Public API
// ============================================================================

/** The replay thesis as code: project the log through the live streaming
 *  projection and let the canonical reducer build the final Session. */
export async function initializeSessionStateFromSdkHistory(
  events: SdkSessionEvent[],
): Promise<Session> {
  const state = createInitialSession();

  for (const event of projectSessionEventsFromSdkHistory(
    events,
    await resolveHistoryAttachments(events),
  )) {
    applySessionEvent(state, event);
  }

  return state;
}

/**
 * Replay a persisted log as canonical SessionEvents.
 *
 * Synchronous on purpose: replay is a hot path (every cold session open
 * replays the full log), and per-event async iteration costs more than the
 * projection itself. Attachment resolution — the only async dependency,
 * scoped to user.message events — is hoisted into resolveHistoryAttachments
 * so this loop stays promise-free.
 */
export function* projectSessionEventsFromSdkHistory(
  events: SdkSessionEvent[],
  attachmentsByEventIndex?: ReadonlyMap<number, Attachment[]>,
): Generator<SessionEvent, void, undefined> {
  const context: HistoryReplayContext = {
    state: createProjectionState(),
    hasVisibleRootTurn: false,
  };

  for (let i = 0; i < events.length; i++) {
    yield* projectHistoryEvent(events[i], context, attachmentsByEventIndex?.get(i));
  }

  // A finished log always lands idle: finalize status, reasoning, and any
  // still-pending tool calls exactly the way a live stream ending would.
  yield { type: "stream_end", reason: "idle" };
}

/** Default resolver: the blob attachments persisted on the record itself. */
const readPersistedAttachments: AttachmentResolver = async (event) =>
  readAttachmentBlobs(readPath(event.data, "attachments"));

/** Pre-resolve user.message attachments so replay can run synchronously. */
export async function resolveHistoryAttachments(
  events: SdkSessionEvent[],
  resolveAttachments: AttachmentResolver = readPersistedAttachments,
): Promise<Map<number, Attachment[]>> {
  const attachmentsByEventIndex = new Map<number, Attachment[]>();

  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "user.message") continue;
    const attachments = await resolveAttachments(events[i], i);
    if (attachments) attachmentsByEventIndex.set(i, attachments);
  }
  return attachmentsByEventIndex;
}

// ============================================================================
// Per-event adaptation table
// ============================================================================

type HistoryEventAdapter = (
  event: SdkSessionEvent,
  context: HistoryReplayContext,
  attachments: Attachment[] | undefined,
) => SessionEvent[];

// The three adaptation rules as a table: log-record event types that must not
// reach the streaming projection as-is. Every event type absent here flows
// through projectSdkEvent unchanged (after the orphan gate below).
const HISTORY_EVENT_ADAPTERS: Record<string, HistoryEventAdapter | undefined> = {
  // ── Rule 3: drop in-flight progress ─────────────────────────────────
  "assistant.turn_start": () => [],
  "session.compaction_start": () => [],
  "session.compaction_complete": () => [],

  // ── Rule 2: lifecycle records carry the model in logs ───────────────
  "session.start": (event) => projectModelChanged(event, "selectedModel"),
  "session.shutdown": (event) => projectModelChanged(event, "currentModel"),

  // ── Rule 1: committed messages instead of deltas ────────────────────
  "user.message": (event, context, attachments) => {
    // Subagent prompts are not root user turns — they're already visible as
    // the agent tool call's arguments.
    if (readAgentId(event)) return [];

    context.hasVisibleRootTurn = true;
    return [
      {
        type: "user_message",
        content: readString(event.data, "content") ?? "",
        timestamp: event.timestamp,
        attachments,
      },
    ];
  },
  "assistant.message": (event, context) => {
    const agentId = readAgentId(event);
    if (agentId) {
      // Subagent output nests under its agent tool call rather than the
      // root transcript (reducer: assistant_message with agentId).
      return [
        {
          type: "assistant_message",
          agentId,
          content: readString(event.data, "content") ?? "",
        },
      ];
    }

    context.hasVisibleRootTurn = true;
    return [
      {
        type: "assistant_message",
        content: readString(event.data, "content") ?? "",
      },
    ];
  },
};

function projectHistoryEvent(
  event: SdkSessionEvent,
  context: HistoryReplayContext,
  attachments: Attachment[] | undefined,
): SessionEvent[] {
  const adapt = HISTORY_EVENT_ADAPTERS[event.type];
  if (adapt) return adapt(event, context, attachments);

  // Orphan gate: a log can open mid-turn (sliced or handed-off histories),
  // leaving leading root tool events with no owning turn. Rendering them
  // would fabricate an assistant message above the first real one, so tool
  // events are dropped until the first visible root message — a once-ever
  // latch, deliberately not a per-turn rule.
  if (!context.hasVisibleRootTurn && event.type.startsWith("tool.")) {
    return [];
  }

  // Everything else replays through the live streaming projection unchanged.
  return projectSdkEvent(withNormalizedAgentId(event), context.state);
}

// ============================================================================
// Legacy field normalization (adaptation rule 2)
// ============================================================================

// Older logs recorded the spawning agent as data.parentToolCallId; current
// streams put the same value at the top level as agentId, which is where the
// streaming projection looks for it.
function readAgentId(event: SdkSessionEvent): string | undefined {
  return readString(event, "agentId") ?? readString(event.data, "parentToolCallId");
}

function withNormalizedAgentId(event: SdkSessionEvent): SdkSessionEvent {
  if (readString(event, "agentId")) return event;

  const agentId = readAgentId(event);
  if (!agentId) return event;

  return {
    ...event,
    agentId,
  };
}

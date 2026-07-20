// Public operations for the session runtime. Headless callers explicitly
// create or deliver; connected callers use one composite that observes while
// optionally doing either. Every mutation acquires the same live runtime.

import { sessionSeedFromSnapshot } from "@/lib/session/sessionReducer";
import type { SessionMessageInput, StreamSessionRequest } from "@/lib/session/protocol";
import type { AgentNotification, QueuedMessage, SessionEvent } from "@/types";
import * as sessionRegistry from "@/functions/state/session/registry";
import { loadSessionSnapshot } from "@/functions/state/session/snapshots";
import { clearDraftPrompt, setSessionStatus } from "@/functions/state/workspace";
import { sharedMap } from "../processState";
import {
  SessionStream,
  SessionStreamClosedError,
  type SessionStreamCompletion,
} from "./sessionStream";

export { SessionStream };
export type { SessionStreamCompletion };

/**
 * Observe a session stream, optionally creating it and delivering a message.
 * Observation is active by default; passive subscriptions do not acknowledge completion.
 */
export async function* streamSession(request: StreamSessionRequest): AsyncGenerator<SessionEvent> {
  if (!request.message) {
    const stream = SessionStream.get(request.sessionId);
    if (stream) yield* stream.subscribe(request.afterEventId, request.mode);
    return;
  }

  const message = normalizeMessage(request.message);
  let retriedClosedStream = false;

  for (;;) {
    const stream = await acquireSessionStream(request.sessionId, message, request.create);
    // Subscribe eagerly before delivery. If another caller already opened the
    // turn, deliver() queues this message and this same subscription follows the
    // active stream through the queued turn instead of returning event-less.
    const events = stream.subscribe(request.afterEventId);

    try {
      await stream.deliver(message);
      clearDraftPrompt(request.sessionId);
    } catch (error) {
      if (error instanceof SessionStreamClosedError && !retriedClosedStream) {
        retriedClosedStream = true;
        await events.return();
        continue;
      }

      // Turn-start failures publish their canonical end/error event before
      // rejecting. Drain those events so the client sees the domain failure
      // rather than a transport exception.
    }

    yield* events;
    return;
  }
}

type MessageInput = SessionMessageInput | { id?: string; notification: AgentNotification };

type SessionCreationOptions = Omit<sessionRegistry.CreateSessionOptions, "model">;

/** Create a session through its required first message without subscribing. */
export function createSession(
  sessionId: string,
  message: SessionMessageInput,
  options: SessionCreationOptions,
) {
  return deliver(sessionId, message, options);
}

/** Deliver to an existing session without subscribing. */
export function deliverSessionMessage(sessionId: string, message: MessageInput) {
  return deliver(sessionId, message);
}

async function deliver(sessionId: string, message: MessageInput, create?: SessionCreationOptions) {
  const normalizedMessage = normalizeMessage(message);
  let retriedClosedStream = false;
  let retriedStaleHandle = false;

  for (;;) {
    try {
      const stream = await acquireSessionStream(sessionId, normalizedMessage, create);
      const disposition = await stream.deliver(normalizedMessage);
      return {
        disposition,
        waitForCompletion: () => stream.waitForCompletion(),
      };
    } catch (error) {
      if (error instanceof SessionStreamClosedError && !retriedClosedStream) {
        retriedClosedStream = true;
        continue;
      }

      // A stale cached SDK handle (possible on the snapshot-seed path, which
      // skips the replay path's getEvents probe) surfaces as a send failure
      // after turn start evicts it and closes the stream. No client is attached
      // to retry, so rebuild once — the resume is fresh by construction and the
      // cached snapshot is still valid (the log never changed).
      if (!retriedStaleHandle && sessionRegistry.evictCachedSessionIfStale(sessionId, error)) {
        retriedStaleHandle = true;
        continue;
      }

      throw error;
    }
  }
}

// Covers concurrent acquisition before the stream reaches the registry.
const pendingStreamCreations = sharedMap<Promise<SessionStream>>("pending-session-streams");

/** Single-flight get-or-create. SessionStream.deliver owns first-turn selection. */
async function acquireSessionStream(
  sessionId: string,
  message: QueuedMessage,
  create?: SessionCreationOptions,
): Promise<SessionStream> {
  const existing = SessionStream.get(sessionId);
  if (existing) return existing;

  const pending = pendingStreamCreations.get(sessionId);
  if (pending) return pending;

  const creation = createStreamForMessage(sessionId, message, create).finally(() => {
    pendingStreamCreations.delete(sessionId);
  });
  pendingStreamCreations.set(sessionId, creation);
  return creation;
}

async function createStreamForMessage(
  sessionId: string,
  message: QueuedMessage,
  create?: SessionCreationOptions,
): Promise<SessionStream> {
  if (create) {
    const model = message.role === "user" ? message.model : undefined;
    setSessionStatus(sessionId, "creating");
    try {
      const sdkSession = await sessionRegistry.createSession(sessionId, {
        ...create,
        model,
      });
      return SessionStream.getOrCreate(sessionId, sdkSession, { model });
    } catch (error) {
      setSessionStatus(sessionId, "idle");
      throw error;
    }
  }

  const snapshot = await loadSessionSnapshot(sessionId);
  const sdkSession = await sessionRegistry.getSession(sessionId);
  return SessionStream.getOrCreate(sessionId, sdkSession, sessionSeedFromSnapshot(snapshot));
}

function normalizeMessage(message: MessageInput): QueuedMessage {
  const id = message.id ?? crypto.randomUUID();

  if ("notification" in message) {
    return {
      id,
      role: "agent_notification",
      notification: message.notification,
    };
  }

  return {
    id,
    role: "user",
    content: message.content,
    attachments: message.attachments,
    model: message.model,
  };
}

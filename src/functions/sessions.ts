// Server function implementations for session management. The shared request
// protocol lives in "@/lib/session/protocol".

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { RawStream } from "@tanstack/router-core";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  listModels as listSdkModels,
  listSessions as listSdkSessions,
  listSkills as listSdkSkills,
} from "./sdk/client";
import * as sessionRegistry from "./state/session/registry";
import { loadSessionSnapshot } from "./state/session/snapshots";
import { clearDraftPrompt } from "./state/workspace";
import {
  applySessionWorktree as applyWorktree,
  getAllSessionWorktrees,
  mergeSessionWorktree as mergeWorktree,
} from "./state/session/worktrees";
import { getWorkerSessionIds } from "./state/session/workers";
import {
  createSession as createRuntimeSession,
  deliverSessionMessage,
  SessionStream,
  streamSession as streamSessionEvents,
} from "./runtime/stream";
import type {
  ModelInfo,
  SessionEvent,
  SessionMetadata,
  SessionSkill,
  SessionSnapshot,
  SessionWorktree,
} from "@/types";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import { toSessionSnapshot } from "@/lib/session/sessionReducer";
import { encodeSessionEvent } from "@/lib/session/streamCodec";
import {
  createSessionInputSchema,
  deliverMessageInputSchema,
  listSkillsInputSchema,
  notifyAgentInputSchema,
  queuedMessageInputSchema,
  renameSessionInputSchema,
  sessionInputSchema,
  streamSessionRequestSchema,
} from "@/lib/session/protocol";

// ============================================================================
// Middleware
// ============================================================================

/** Middleware that validates sessionId input - reused across multiple server functions */
const withSessionId = createMiddleware({ type: "function" }).validator(
  zodValidator(sessionInputSchema),
);

// ============================================================================
// Server Functions
// ============================================================================

export type SessionsState = {
  sessions: SessionMetadata[];
  worktrees: Record<string, SessionWorktree>;
  workerSessionIds: string[];
};

/** Fetch durable session list metadata in a single round-trip. */
export const getSessionsState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionsState> => {
    const [sessions, worktrees, workerSessionIds] = await Promise.all([
      listSdkSessions(),
      getAllSessionWorktrees(),
      getWorkerSessionIds(),
    ]);

    return {
      sessions,
      worktrees,
      workerSessionIds,
    };
  },
);

/** List available models */
export const listModels = createServerFn({ method: "GET" }).handler(
  async (): Promise<ModelInfo[]> => {
    return listSdkModels();
  },
);

/** List user-invocable skills for a CWD, or host-level skills when it is omitted. */
export const listSkills = createServerFn({ method: "POST" })
  .validator(zodValidator(listSkillsInputSchema))
  .handler(async ({ data }): Promise<SessionSkill[]> => {
    return listSdkSkills(data.cwd);
  });

/** A session's reduced transcript snapshot, served from the cheapest source
 *  that is still truthful: the live stream's in-memory state, then the
 *  cold-path ladder (snapshot cache, then SDK resume + full history replay,
 *  which repopulates the cache for the next open). */
export const querySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<SessionSnapshot> => {
    const stream = SessionStream.get(data.sessionId);
    if (stream) {
      return toSessionSnapshot(data.sessionId, stream.getSessionState());
    }

    return loadSessionSnapshot(data.sessionId);
  });

function createEventByteStream(iterator: AsyncGenerator<SessionEvent>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encodeSessionEvent(next.value));
      } catch (error) {
        // Expected runtime failures are emitted as session end/error events.
        // Reaching the transport error path means the adapter itself failed.
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

export const streamSession = createServerFn({ method: "POST" })
  .validator(zodValidator(streamSessionRequestSchema))
  .handler(async ({ data }) => {
    const iterator = streamSessionEvents(data);
    return new RawStream(createEventByteStream(iterator), { hint: "text" });
  });

/** Create a session and run its first turn without any client stream attached.
 *  Clients observe progress through the broadcast plane alone (upsert →
 *  running → idle/unread), the same way automation and agent-spawned sessions
 *  surface. Resolves once the turn has opened, not when it completes. */
export const createSession = createServerFn({ method: "POST" })
  .validator(zodValidator(createSessionInputSchema))
  .handler(async ({ data }): Promise<{ sessionId: string }> => {
    const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
    await createRuntimeSession(sessionId, data.message, {
      directory: data.directory,
      useWorktree: data.useWorktree,
      sessionType: "standard",
    });
    return { sessionId };
  });

/** Deliver a follow-up message. The runtime decides whether it sends now or queues. */
export const deliverMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(deliverMessageInputSchema))
  .handler(async ({ data }): Promise<{ disposition: "started" | "queued" }> => {
    const receipt = await deliverSessionMessage(data.sessionId, data.message);
    clearDraftPrompt(data.sessionId);
    return { disposition: receipt.disposition };
  });

/** Notify a session's agent over the side channel. Active sessions queue it
 *  (coalescing equivalents); idle historical sessions are resumed and processed. */
export const notifyAgent = createServerFn({ method: "POST" })
  .validator(zodValidator(notifyAgentInputSchema))
  .handler(async ({ data }): Promise<void> => {
    await deliverSessionMessage(data.sessionId, {
      notification: data.notification,
    });
  });

/** Cancel a queued message by ID (before it's been sent to the SDK) */
export const cancelQueuedMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(queuedMessageInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    return stream?.cancelQueuedMessage(data.queuedMessageId) ?? false;
  });

/** Steer a queued message into the active SDK turn and await acceptance. */
export const steerQueuedMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(queuedMessageInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    return stream?.steerQueuedMessage(data.queuedMessageId) ?? false;
  });

/** Abort the currently processing message in a session.
 *  Closes the stream (which clears buffer, queue, and SDK listener). */
export const abortSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    const stream = SessionStream.get(data.sessionId);
    if (stream) {
      await stream.abort();
    }
    return true;
  });

/** Delete a session and release resources */
export const deleteSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    await sessionRegistry.deleteSession(data.sessionId);
    return true;
  });

/** Rename a session using the SDK's persisted friendly-name metadata. */
export const renameSession = createServerFn({ method: "POST" })
  .validator(zodValidator(renameSessionInputSchema))
  .handler(async ({ data }): Promise<boolean> => {
    await sessionRegistry.renameSession(data.sessionId, data.name);
    return true;
  });

/** Merge a worktree session's changes back into its base branch */
export const mergeSessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => mergeWorktree(data.sessionId));

/** Apply a worktree session's changes to its base branch as uncommitted modifications */
export const applySessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => applyWorktree(data.sessionId));

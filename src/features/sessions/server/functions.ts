// Validated remote ingress for session operations.

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { zodValidator } from "@tanstack/zod-adapter";
import type { RealtimeToken } from "@tanstack/ai";
import type { ServerRequest } from "nitro/types";
import {
  listModels as listSdkModels,
  listSessions as listSdkSessions,
  listSkills as listSdkSkills,
} from "@sessions/server/sdk/client";
import * as sessionRegistry from "@sessions/server/state/registry";
import { clearDraftPrompt } from "@workspace/server/state";
import {
  applySessionWorktree as applyWorktree,
  getAllSessionWorktrees,
  mergeSessionWorktree as mergeWorktree,
} from "@sessions/server/state/worktrees";
import { getWorkerSessionParents } from "@workers/server/database";
import {
  abortSession as abortRuntimeSession,
  cancelQueuedMessage as cancelRuntimeQueuedMessage,
  createSession as createRuntimeSession,
  deliverSessionMessage,
  getSessionSnapshot,
  rewindSession as rewindRuntimeSession,
  steerQueuedMessage as steerRuntimeQueuedMessage,
  streamSession as streamSessionEvents,
  waitForSession as waitForRuntimeSession,
} from "@sessions/server/runtime";
import type {
  ModelInfo,
  SessionCompletion,
  SessionSkill,
  SessionSnapshot,
  SessionsState,
} from "../model";
import { SESSION_ID_PREFIX } from "../model/constants";
import {
  sessionLaunchSchema,
  createDraftSessionInputSchema,
  deliverMessageInputSchema,
  listSkillsInputSchema,
  notifyAgentInputSchema,
  queuedMessageInputSchema,
  renameSessionInputSchema,
  rewindSessionInputSchema,
  sessionInputSchema,
  streamSessionRequestSchema,
  waitForSessionInputSchema,
} from "../model/protocol";

const REALTIME_MODEL = "gpt-realtime";

const withSessionId = createMiddleware({ type: "function" }).validator(
  zodValidator(sessionInputSchema),
);

/** Fetch durable session list metadata in a single round-trip. */
export const getSessionsState = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionsState> => {
    // Worker registration precedes SDK session creation, while SDK deletion
    // precedes unregistering. Reading ownership on both sides of the SDK list
    // therefore closes both races and gives list projections complete worker
    // ownership without discarding metadata needed by linked panes.
    const workerSessionParentsBefore = await getWorkerSessionParents();
    const [allSessions, worktrees] = await Promise.all([
      listSdkSessions(),
      getAllSessionWorktrees(),
    ]);
    const workerSessionParentsAfter = await getWorkerSessionParents();

    return {
      sessions: allSessions,
      worktrees,
      workerSessionParents: {
        ...workerSessionParentsBefore,
        ...workerSessionParentsAfter,
      },
    };
  },
);

export const listModels = createServerFn({ method: "GET" }).handler(
  async (): Promise<ModelInfo[]> => {
    return listSdkModels();
  },
);

/** Mint a short-lived OpenAI Realtime client secret for voice input. */
export const createVoiceToken = createServerFn({ method: "POST" }).handler(
  async (): Promise<RealtimeToken> => {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("Voice is unavailable: OPENAI_API_KEY is not set on the server.");
    }
    const [{ realtimeToken }, { openaiRealtimeToken }] = await Promise.all([
      import("@tanstack/ai"),
      import("@tanstack/ai-openai"),
    ]);
    return realtimeToken({ adapter: openaiRealtimeToken({ model: REALTIME_MODEL }) });
  },
);

/** List user-invocable skills for a CWD, or host-level skills when it is omitted. */
export const listSkills = createServerFn({ method: "POST" })
  .validator(zodValidator(listSkillsInputSchema))
  .handler(async ({ data }): Promise<SessionSkill[]> => {
    return listSdkSkills(data.cwd, data.sessionType);
  });

/** A session's reduced transcript snapshot, served from the cheapest source
 *  that is still truthful: the live stream's in-memory state, then the
 *  cold-path ladder (snapshot cache, then SDK resume + full history replay,
 *  which repopulates the cache for the next open). */
export const querySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(({ data }): Promise<SessionSnapshot> => getSessionSnapshot(data.sessionId));

/** Wait for the announced, live, or latest persisted execution of one session. */
export const waitForSession = createServerFn({ method: "POST" })
  .validator(zodValidator(waitForSessionInputSchema))
  .handler(
    ({ data }): Promise<SessionCompletion> => waitForRuntimeSession(data.sessionId, data.timeoutMs),
  );

export const streamSession = createServerFn({ method: "POST" })
  .validator(zodValidator(streamSessionRequestSchema))
  .handler(async function* ({ data }) {
    const request = getRequest() as ServerRequest;
    request.runtime?.bun?.server.timeout(request, 0);
    const subscription = await streamSessionEvents(data);
    if (!subscription) return;

    // Returning TanStack's serialized client iterator does not reach this
    // underlying subscription. The browser instead aborts its fetch; Nitro/Bun
    // exposes that disconnect through request.signal, and this bridge releases
    // the server subscriber without affecting the session's work.
    const disconnect = () => void subscription.return();
    request.signal.addEventListener("abort", disconnect, { once: true });
    if (request.signal.aborted) disconnect();

    yield* subscription;
  });

/** Create a session and run its first turn without any client stream attached.
 *  Clients receive progress through the broadcast plane alone (upsert →
 *  running → idle/unread), the same way automation and agent-spawned sessions
 *  surface. Resolves once the turn has opened, not when it completes. */
export const createSession = createServerFn({ method: "POST" })
  .validator(zodValidator(sessionLaunchSchema))
  .handler(async ({ data }): Promise<{ sessionId: string }> => {
    const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
    await createRuntimeSession(sessionId, data.message, {
      directory: data.directory,
      useWorktree: data.useWorktree,
      sessionType: "standard",
    });
    return { sessionId };
  });

/** Create a durable zero-turn SDK workspace while retaining draft UX semantics. */
export const createDraftSession = createServerFn({ method: "POST" })
  .validator(zodValidator(createDraftSessionInputSchema))
  .handler(({ data: { sessionId, ...options } }) =>
    sessionRegistry.createDraftSession(sessionId, options),
  );

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

export const cancelQueuedMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(queuedMessageInputSchema))
  .handler(({ data }): boolean => cancelRuntimeQueuedMessage(data.sessionId, data.clientId));

/** Steer a queued message into the active SDK turn and await acceptance. */
export const steerQueuedMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(queuedMessageInputSchema))
  .handler(
    ({ data }): Promise<boolean> => steerRuntimeQueuedMessage(data.sessionId, data.clientId),
  );

/** Abort the currently processing message in a session.
 *  Finishes the stream after interrupting SDK work. */
export const abortSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    await abortRuntimeSession(data.sessionId);
    return true;
  });

/** Rewind an idle local session to immediately before one root user message. */
export const rewindSession = createServerFn({ method: "POST" })
  .validator(zodValidator(rewindSessionInputSchema))
  .handler(
    ({ data }): Promise<SessionSnapshot> => rewindRuntimeSession(data.sessionId, data.timestamp),
  );

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

export const mergeSessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => mergeWorktree(data.sessionId));

export const applySessionWorktree = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }) => applyWorktree(data.sessionId));

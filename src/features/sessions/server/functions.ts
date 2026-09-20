// Validated remote ingress for session operations.

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { zodValidator } from "@tanstack/zod-adapter";
import type { RealtimeToken } from "@tanstack/ai";
import type { ServerRequest } from "nitro/types";
import {
  listSessions as listProviderSessions,
  listSkills as listProviderSkills,
} from "@sessions/server/providers";
import * as sessionRegistry from "@sessions/server/state/registry";
import {
  applySessionWorktree as applyWorktree,
  getAllSessionWorktrees,
  mergeSessionWorktree as mergeWorktree,
} from "@sessions/server/state/worktrees";
import {
  answerSessionQuestion as answerRuntimeSessionQuestion,
  abortSession as abortRuntimeSession,
  cancelQueuedMessage as cancelRuntimeQueuedMessage,
  createSession as createRuntimeSession,
  deliverSessionMessage,
  getSessionSnapshot,
  rewindSession as rewindRuntimeSession,
  steerQueuedMessage as steerRuntimeQueuedMessage,
  streamSession as streamSessionEvents,
  waitForSessions,
} from "@sessions/server/runtime";
import type { SessionCompletion, SessionSkill, SessionState } from "../model";
import {
  answerSessionQuestionInputSchema,
  sessionLaunchSchema,
  createSessionInputSchema,
  deliverMessageInputSchema,
  listSkillsInputSchema,
  sendSystemMessageInputSchema,
  queuedMessageInputSchema,
  renameSessionInputSchema,
  resolveSessionContextInputSchema,
  rewindSessionInputSchema,
  sessionInputSchema,
  streamSessionRequestSchema,
  waitForSessionInputSchema,
} from "../model/protocol";
import { readSessionCatalog } from "@/server/managedSessions";
import { resolveSessionContext as resolveGitContext } from "./git";

const REALTIME_MODEL = "gpt-realtime";

const withSessionId = createMiddleware({ type: "function" }).validator(
  zodValidator(sessionInputSchema),
);

/** Fetch durable session list metadata in a single round-trip. */
export const getSessionsState = createServerFn({ method: "GET" }).handler(() =>
  readSessionCatalog(() => Promise.all([listProviderSessions(), getAllSessionWorktrees()])),
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
    return realtimeToken({
      adapter: openaiRealtimeToken({ model: REALTIME_MODEL }),
    });
  },
);

/** List user-invocable skills for a CWD, or host-level skills when it is omitted. */
export const listSkills = createServerFn({ method: "POST" })
  .validator(zodValidator(listSkillsInputSchema))
  .handler(async ({ data }): Promise<SessionSkill[]> => {
    return listProviderSkills(data.cwd, data.sessionType, data.provider);
  });

export const resolveSessionContext = createServerFn({ method: "POST" })
  .validator(zodValidator(resolveSessionContextInputSchema))
  .handler(({ data }) => resolveGitContext(data.directory));

/** A session's reduced transcript snapshot, served from the cheapest source
 *  that is still truthful: the live stream's in-memory state, then the
 *  cold-path ladder (snapshot cache, then read-only provider history replay,
 *  which repopulates the cache for the next open). */
export const querySession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(({ data }): Promise<SessionState> => getSessionSnapshot(data.sessionId));

/** Wait for the announced, live, or latest persisted execution of one session. */
export const waitForSession = createServerFn({ method: "POST" })
  .validator(zodValidator(waitForSessionInputSchema))
  .handler(async ({ data }): Promise<SessionCompletion> => {
    const [completion] = await waitForSessions([data.sessionId], data.timeoutMs);
    return completion!;
  });

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
export const startSession = createServerFn({ method: "POST" })
  .validator(zodValidator(sessionLaunchSchema))
  .handler(async ({ data }): Promise<{ sessionId: string }> => {
    const sessionId = crypto.randomUUID();
    await createRuntimeSession(sessionId, data.message, {
      ...data.location,
      sessionType: "standard",
    });
    return { sessionId };
  });

/** Reserve a provider-independent draft and its optional initial artifact. */
export const createSession = createServerFn({ method: "POST" })
  .validator(zodValidator(createSessionInputSchema))
  .handler(({ data: { sessionId, ...options } }) =>
    sessionRegistry.createSessionRecord(sessionId, options),
  );

/** Deliver a follow-up message, optionally requesting immediate delivery. */
export const deliverMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(deliverMessageInputSchema))
  .handler(async ({ data }): Promise<{ disposition: "started" | "queued" }> => {
    const receipt = await deliverSessionMessage(data.sessionId, data.message);
    return { disposition: receipt.disposition };
  });

/** Deliver a system message. Active Sessions queue equivalent messages together;
 *  idle historical Sessions resume and process them. */
export const sendSystemMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(sendSystemMessageInputSchema))
  .handler(async ({ data }): Promise<void> => {
    await deliverSessionMessage(data.sessionId, { systemMessage: data.message });
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

export const answerSessionQuestion = createServerFn({ method: "POST" })
  .validator(zodValidator(answerSessionQuestionInputSchema))
  .handler(
    ({ data: { sessionId, ...answer } }): Promise<boolean> =>
      answerRuntimeSessionQuestion(sessionId, answer),
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
    ({ data }): Promise<SessionState> => rewindRuntimeSession(data.sessionId, data.timestamp),
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

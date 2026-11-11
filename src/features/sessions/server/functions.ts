// Validated remote ingress for session operations.

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { RealtimeToken } from "@tanstack/ai";
import type { ServerRequest } from "nitro/types";
import {
  findSessions,
  listSessions as listProviderSessions,
  listSkills as listProviderSkills,
} from "@sessions/server/providers";
import * as sessionActivity from "@sessions/server/state/activity";
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
  waitForSessions,
} from "@sessions/server/runtime";
import type { SessionCompletion, SessionSkill, SessionState } from "../model";
import { latestMessages, messagesBefore } from "../model/transcriptPages";
import {
  answerSessionQuestionInputSchema,
  createSessionInputSchema,
  deliverMessageInputSchema,
  listSkillsInputSchema,
  queuedMessageInputSchema,
  querySessionMessagesInputSchema,
  renameSessionInputSchema,
  resolveSessionContextInputSchema,
  rewindSessionInputSchema,
  sessionInputSchema,
  waitForSessionInputSchema,
} from "../model/protocol";
import { readSessionCatalog } from "@/server/managedSessions";
import { resolveSessionContext as resolveGitContext } from "./git";

const REALTIME_MODEL = "gpt-realtime";

const withSessionId = createMiddleware({ type: "function" }).validator(sessionInputSchema);

/** Fetch durable session list metadata in a single round-trip. */
export const getSessionsState = createServerFn({ method: "GET" }).handler(() =>
  readSessionCatalog({
    list: (limit) => Promise.all([listProviderSessions(limit), getAllSessionWorktrees()]),
    find: findSessions,
  }),
);

/** Fetch every non-idle session's current activity. */
export const getSessionsActivity = createServerFn({ method: "GET" }).handler(() =>
  sessionActivity.getSessionsActivity(),
);

/** Mark a session's unread results as seen on every client. */
export const markSessionRead = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(({ data }): boolean => {
    sessionActivity.markSessionRead(data.sessionId);
    return true;
  });

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
  .validator(listSkillsInputSchema)
  .handler(async ({ data }): Promise<SessionSkill[]> => {
    return listProviderSkills(data.cwd, data.provider);
  });

export const resolveSessionContext = createServerFn({ method: "POST" })
  .validator(resolveSessionContextInputSchema)
  .handler(({ data }) => resolveGitContext(data.directory));

/** The page of messages before position `before`, ending with that message. */
export const querySessionMessages = createServerFn({ method: "POST" })
  .validator(querySessionMessagesInputSchema)
  .handler(async ({ data }) =>
    messagesBefore((await getSessionSnapshot(data.sessionId)).messages, data.before),
  );

/** Wait for the announced, live, or latest persisted execution of one session. */
export const waitForSession = createServerFn({ method: "POST" })
  .validator(waitForSessionInputSchema)
  .handler(async ({ data }): Promise<SessionCompletion> => {
    const [completion] = await waitForSessions([data.sessionId], data.timeoutMs);
    return completion!;
  });

/** Reserve a provider-independent draft and its optional initial artifact. */
export const createSession = createServerFn({ method: "POST" })
  .validator(createSessionInputSchema)
  .handler(({ data: { sessionId, ...options } }) =>
    sessionRegistry.createSessionRecord(sessionId, options),
  );

/** Deliver a message, optionally requesting immediate delivery. A location creates the
 *  session with it as the first message. Clients subscribe to the work separately. */
export const deliverMessage = createServerFn({ method: "POST" })
  .validator(deliverMessageInputSchema)
  .handler(async ({ data: { sessionId, message, location } }): Promise<void> => {
    // Provider creation or resumption can outlast Bun's idle request timeout.
    const request = getRequest() as ServerRequest;
    request.runtime?.bun?.server.timeout(request, 0);
    if (location) await createRuntimeSession(sessionId, message, location);
    else await deliverSessionMessage(sessionId, message);
  });

export const cancelQueuedMessage = createServerFn({ method: "POST" })
  .validator(queuedMessageInputSchema)
  .handler(({ data }): boolean => cancelRuntimeQueuedMessage(data.sessionId, data.clientId));

/** Steer a queued message into the active SDK turn and await acceptance. */
export const steerQueuedMessage = createServerFn({ method: "POST" })
  .validator(queuedMessageInputSchema)
  .handler(({ data }): Promise<boolean> =>
    steerRuntimeQueuedMessage(data.sessionId, data.clientId),
  );

export const answerSessionQuestion = createServerFn({ method: "POST" })
  .validator(answerSessionQuestionInputSchema)
  .handler(({ data: { sessionId, ...answer } }): Promise<boolean> =>
    answerRuntimeSessionQuestion(sessionId, answer),
  );

/** Abort the currently processing message in a session.
 *  Finishes the execution after interrupting SDK work. */
export const abortSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    await abortRuntimeSession(data.sessionId);
    return true;
  });

/** Rewind an idle local session to immediately before one root user message. */
export const rewindSession = createServerFn({ method: "POST" })
  .validator(rewindSessionInputSchema)
  .handler(async ({ data }): Promise<SessionState> =>
    latestMessages(await rewindRuntimeSession(data.sessionId, data.timestamp)),
  );

export const deleteSession = createServerFn({ method: "POST" })
  .middleware([withSessionId])
  .handler(async ({ data }): Promise<boolean> => {
    await sessionRegistry.deleteSession(data.sessionId);
    return true;
  });

/** Rename a session using the SDK's persisted friendly-name metadata. */
export const renameSession = createServerFn({ method: "POST" })
  .validator(renameSessionInputSchema)
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

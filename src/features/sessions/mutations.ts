import { mutationOptions } from "@tanstack/react-query";
import {
  answerSessionQuestion,
  abortSession,
  applySessionWorktree,
  cancelQueuedMessage,
  createSession,
  deleteSession,
  deliverMessage,
  markSessionRead,
  mergeSessionWorktree,
  renameSession,
  rewindSession as requestSessionRewind,
  steerQueuedMessage,
} from "./server/functions";
import { adoptSessionSnapshot, sessionQueries } from "./queries";
import { applyWorkspaceEvent } from "@workspace/sync";
import { generateUUID } from "@/shared/utils";
import type { SessionLaunch, SessionState } from "./model";
import type { SessionQuestionAnswer } from "./model/protocol";

type CreateSessionVariables = {
  sessionId: string;
  createdAt: number;
  artifact?: { path: string; content: string };
  hyper?: true;
};

export const sessionMutations = {
  startSession: () =>
    mutationOptions({
      // Starts headlessly: the first message's location creates the session, and
      // clients see its progress through the broadcast plane alone.
      mutationFn: async ({ message, location }: SessionLaunch) => {
        const sessionId = generateUUID();
        await deliverMessage({ data: { sessionId, message, location: location ?? {} } });
        return { sessionId };
      },
      // The catalog admits the session once the server has created it. Native discovery
      // can lag a new session, so a refetch here could drop it; omitting timestamps
      // keeps this idempotent with the broadcast.
      onSuccess: ({ sessionId }, _launch, _context, { client }) => {
        applyWorkspaceEvent(client, {
          type: "session.upserted",
          session: { id: sessionId, sessionType: "standard" },
        });
      },
    }),

  createSession: () =>
    mutationOptions({
      mutationFn: ({ sessionId, artifact, hyper }: CreateSessionVariables) =>
        createSession({
          data: {
            sessionId,
            ...(artifact ? { artifact } : {}),
            ...(hyper ? { hyper: true } : {}),
          },
        }),
      onMutate: ({ sessionId, createdAt, artifact, hyper }, { client }) => {
        const timestamp = new Date(createdAt).toISOString();
        applyWorkspaceEvent(client, {
          type: "session.upserted",
          session: {
            id: sessionId,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(artifact ? { artifactPath: artifact.path } : {}),
            sessionType: hyper ? "hyper" : "standard",
          },
        });
      },
      onError: (_error, { sessionId }, _context, { client }) => {
        applyWorkspaceEvent(client, { type: "session.deleted", sessionId });
      },
    }),

  deleteSession: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => deleteSession({ data: { sessionId } }),
      // Only the catalog hides the session until the server confirms. Every other
      // workspace cache waits for the confirmed event.
      onMutate: (_variables, { client }) => {
        sessionQueries.state.apply(client, { type: "session.deleted", sessionId });
      },
      onError: (_error, _variables, _context, { client }) => sessionQueries.state.repair(client),
      onSuccess: (_result, _variables, _context, { client }) => {
        applyWorkspaceEvent(client, { type: "session.deleted", sessionId });
      },
    }),

  renameSession: (sessionId: string) =>
    mutationOptions({
      mutationFn: (name: string) => renameSession({ data: { sessionId, name } }),
      onMutate: (name, { client }) => {
        applyWorkspaceEvent(client, {
          type: "session.upserted",
          session: { id: sessionId, title: name },
        });
      },
      onError: (_error, _variables, _context, { client }) => sessionQueries.state.repair(client),
    }),

  markRead: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => markSessionRead({ data: { sessionId } }),
      onMutate: (_variables, { client }) => {
        applyWorkspaceEvent(client, { type: "session.read", sessionId });
      },
      onError: (_error, _variables, _context, { client }) => sessionQueries.activity.repair(client),
    }),

  // The session's subscription waits for this client's deliveries by sharing its detail's key.
  deliverMessage: (sessionId: string) =>
    mutationOptions({
      mutationKey: sessionQueries.detail(sessionId).queryKey,
      mutationFn: ({ message, location }: SessionLaunch & { message: { clientId: string } }) =>
        deliverMessage({ data: { sessionId, message, location } }),
    }),

  answerSessionQuestion: (sessionId: string) =>
    mutationOptions({
      mutationFn: (answer: SessionQuestionAnswer) =>
        answerSessionQuestion({ data: { sessionId, ...answer } }),
    }),

  abortSession: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => abortSession({ data: { sessionId } }),
      // Restarts the subscription the abort ended. Its fetch lasts while the detail is
      // watched, so the mutation must not wait for it.
      onSettled: (_result, _error, _variables, _onMutateResult, { client }) => {
        void client.invalidateQueries({ queryKey: sessionQueries.detail(sessionId).queryKey });
      },
    }),

  rewindSession: (sessionId: string, timestamp: string) =>
    mutationOptions({
      mutationFn: () => requestSessionRewind({ data: { sessionId, timestamp } }),
      onSuccess: (snapshot, _variables, _onMutateResult, { client }) =>
        client.setQueryData<SessionState>(sessionQueries.detail(sessionId).queryKey, (current) =>
          adoptSessionSnapshot(current, snapshot),
        ),
    }),

  mergeWorktree: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => mergeSessionWorktree({ data: { sessionId } }),
      onSuccess: (_result, _variables, _onMutateResult, { client }) =>
        client.invalidateQueries({ queryKey: sessionQueries.state.queryKey }),
    }),

  applyWorktree: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => applySessionWorktree({ data: { sessionId } }),
      onSuccess: (_result, _variables, _onMutateResult, { client }) =>
        client.invalidateQueries({ queryKey: sessionQueries.state.queryKey }),
    }),

  cancelQueuedMessage: (sessionId: string) =>
    mutationOptions({
      mutationFn: (clientId: string) => cancelQueuedMessage({ data: { sessionId, clientId } }),
    }),

  steerQueuedMessage: (sessionId: string) =>
    mutationOptions({
      mutationFn: (clientId: string) => steerQueuedMessage({ data: { sessionId, clientId } }),
    }),
};

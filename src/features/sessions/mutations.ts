import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  answerSessionQuestion,
  abortSession,
  applySessionWorktree,
  cancelQueuedMessage,
  createDraftSession,
  createSession,
  deleteSession,
  deliverMessage,
  mergeSessionWorktree,
  renameSession,
  rewindSession as requestSessionRewind,
  steerQueuedMessage,
} from "./server/functions";
import { sessionQueries } from "./queries";
import {
  cancelSessionsStateQuery,
  removeSessionFromState,
  restoreSessionsState,
  snapshotSessionsState,
  upsertSessionInState,
} from "./queryCache";
import { applyWorkspaceEvent } from "@workspace/queries";
import type { SessionLaunch, SessionMessage } from "./model";
import type { SessionQuestionAnswer } from "./model/protocol";

type MessageDelivery = SessionMessage & { clientId: string; immediate?: true };
type CreateDraftSessionVariables = {
  sessionId: string;
  createdAt: number;
  artifact?: { path: string; content: string };
  hyper?: true;
};

export const sessionMutations = {
  createSession: () =>
    mutationOptions({
      mutationFn: (launch: SessionLaunch) => createSession({ data: launch }),
    }),

  createDraftSession: () =>
    mutationOptions({
      mutationFn: ({ sessionId, artifact, hyper }: CreateDraftSessionVariables) =>
        createDraftSession({
          data: {
            sessionId,
            ...(artifact ? { artifact } : {}),
            ...(hyper ? { hyper: true } : {}),
          },
        }),
      onMutate: ({ sessionId, createdAt, artifact, hyper }, { client }) => {
        applyWorkspaceEvent(client, {
          type: "session.drafted",
          sessionId,
          createdAt,
          ...(artifact ? { artifactPath: artifact.path } : {}),
          ...(hyper ? { hyper: true } : {}),
        });
      },
      onError: (_error, { sessionId }, _context, { client }) => {
        applyWorkspaceEvent(client, { type: "session.deleted", sessionId });
      },
    }),

  deleteSession: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => deleteSession({ data: { sessionId } }),
      onMutate: async (_variables, { client }) => {
        await cancelSessionsStateQuery(client);
        const previousSessionsState = snapshotSessionsState(client);
        removeSessionFromState(client, sessionId);
        return { previousSessionsState };
      },
      onError: (_error, _variables, context, { client }) => {
        if (context?.previousSessionsState) {
          restoreSessionsState(client, context.previousSessionsState);
        }
      },
      onSuccess: (_result, _variables, _context, { client }) => {
        applyWorkspaceEvent(client, { type: "session.deleted", sessionId });
      },
    }),

  renameSession: (sessionId: string) =>
    mutationOptions({
      mutationFn: (name: string) => renameSession({ data: { sessionId, name } }),
      onMutate: async (name, { client }) => {
        await cancelSessionsStateQuery(client);
        const previousSessionsState = snapshotSessionsState(client);
        upsertSessionInState(client, { sessionId, summary: name });
        return { previousSessionsState };
      },
      onError: (_error, _variables, context, { client }) => {
        if (context?.previousSessionsState) {
          restoreSessionsState(client, context.previousSessionsState);
        }
      },
    }),

  deliverMessage: (sessionId: string) =>
    mutationOptions({
      mutationFn: ({ immediate, ...message }: MessageDelivery) =>
        deliverMessage({ data: { sessionId, message, immediate } }),
    }),

  answerSessionQuestion: (sessionId: string) =>
    mutationOptions({
      mutationFn: (answer: SessionQuestionAnswer) =>
        answerSessionQuestion({ data: { sessionId, ...answer } }),
      onSuccess: (accepted, _variables, _onMutateResult, { client }) => {
        if (!accepted) return invalidateSession(client, sessionId);
      },
    }),

  abortSession: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => abortSession({ data: { sessionId } }),
      onSettled: (_result, _error, _variables, _onMutateResult, { client }) =>
        invalidateSession(client, sessionId),
    }),

  rewindSession: (sessionId: string, timestamp: string) =>
    mutationOptions({
      mutationFn: () => requestSessionRewind({ data: { sessionId, timestamp } }),
      onSuccess: (snapshot, _variables, _onMutateResult, { client }) =>
        client.setQueryData(sessionQueries.detail(sessionId).queryKey, snapshot),
    }),

  mergeWorktree: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => mergeSessionWorktree({ data: { sessionId } }),
      onSuccess: (_result, _variables, _onMutateResult, { client }) =>
        client.invalidateQueries({ queryKey: sessionQueries.stateKey() }),
    }),

  applyWorktree: (sessionId: string) =>
    mutationOptions({
      mutationFn: () => applySessionWorktree({ data: { sessionId } }),
      onSuccess: (_result, _variables, _onMutateResult, { client }) =>
        client.invalidateQueries({ queryKey: sessionQueries.stateKey() }),
    }),

  cancelQueuedMessage: (sessionId: string) =>
    mutationOptions({
      mutationFn: (clientId: string) => cancelQueuedMessage({ data: { sessionId, clientId } }),
      onSuccess: (changed, _variables, _onMutateResult, { client }) => {
        if (!changed) return invalidateSession(client, sessionId);
      },
    }),

  steerQueuedMessage: (sessionId: string) =>
    mutationOptions({
      mutationFn: (clientId: string) => steerQueuedMessage({ data: { sessionId, clientId } }),
      onSuccess: (changed, _variables, _onMutateResult, { client }) => {
        if (!changed) return invalidateSession(client, sessionId);
      },
    }),
};

function invalidateSession(client: QueryClient, sessionId: string) {
  return client.invalidateQueries({ queryKey: sessionQueries.detail(sessionId).queryKey });
}

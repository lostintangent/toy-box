import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { generateUUID } from "@/shared/utils";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { sessionMutations } from "./mutations";
import { sessionQueries } from "./queries";
import type { SessionsState } from "./model";

function selectCatalog(state: SessionsState) {
  return {
    sessions: state.sessions,
    ownership: state.ownership,
    worktreeSessionIds: Object.keys(state.worktrees),
  };
}

/** Session catalog and optimistic creation, including reuse of an untouched session. */
export function useSessions() {
  const { data } = useSuspenseQuery({ ...sessionQueries.state, select: selectCatalog });
  const create = useMutation(sessionMutations.createSession());
  const draftSessions = data.sessions.filter(
    (session) => !session.provider && !data.ownership[session.id],
  );
  const hyperSessionId = useWorkspaceSelector((workspace) => workspace.settings.hyperSessionId);
  const drafts = useWorkspaceSelector((workspace) =>
    Object.fromEntries(
      draftSessions.map(({ id }) => {
        const draft = workspace.drafts[`session:${id}`];
        return [id, { hasText: Boolean(draft?.text), updatedAt: draft?.updatedAt }];
      }),
    ),
  );
  const sessions = data.sessions.map((session) => {
    const updatedAt = drafts[session.id]?.updatedAt;
    return updatedAt ? { ...session, updatedAt: new Date(updatedAt) } : session;
  });

  function createSession(options?: { hyper?: true; artifact?: { path: string; content: string } }) {
    if (!options?.hyper && !options?.artifact) {
      const reusable = draftSessions.find(
        (session) =>
          !session.artifactPath && !drafts[session.id]?.hasText && session.id !== hyperSessionId,
      );
      if (reusable) return reusable.id;
    }
    const sessionId = generateUUID();
    create.mutate({ sessionId, createdAt: Date.now(), ...options });
    return sessionId;
  }

  return {
    sessions,
    ownership: data.ownership,
    worktreeSessionIds: data.worktreeSessionIds,
    createSession,
  };
}

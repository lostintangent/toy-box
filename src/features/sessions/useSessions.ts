import { useMutation, useQuery } from "@tanstack/react-query";
import { generateUUID } from "@/shared/utils";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { sessionMutations } from "./mutations";
import { selectNonWorkerSessions, sessionQueries } from "./queries";
import type { SessionsState } from "./model";

function selectCatalog(state: SessionsState) {
  return {
    sessions: selectNonWorkerSessions(state),
    worktreeSessionIds: Object.keys(state.worktrees),
  };
}

/** Session catalog and optimistic creation, including reuse of an untouched session. */
export function useSessions({ hiddenSessionIds }: { hiddenSessionIds: string[] }) {
  const { data, isLoading } = useQuery({ ...sessionQueries.state(), select: selectCatalog });
  const create = useMutation(sessionMutations.createSession());
  const draftSessions = data?.sessions.filter((session) => !session.provider) ?? [];
  const prompts = useWorkspaceSelector((workspace) =>
    Object.fromEntries(
      draftSessions.map(({ id }) => {
        const prompt = workspace.sessionStates[id]?.prompt;
        return [id, { hasText: Boolean(prompt?.text), updatedAt: prompt?.updatedAt }];
      }),
    ),
  );
  const sessions = data?.sessions.map((session) => {
    const updatedAt = prompts[session.id]?.updatedAt;
    return updatedAt ? { ...session, updatedAt: new Date(updatedAt) } : session;
  });

  function createSession(options?: { hyper?: true; artifact?: { path: string; content: string } }) {
    if (!options?.hyper && !options?.artifact) {
      const reusable = draftSessions.find(
        (session) =>
          !session.artifactPath &&
          !prompts[session.id]?.hasText &&
          !hiddenSessionIds.includes(session.id),
      );
      if (reusable) return reusable.id;
    }
    const sessionId = generateUUID();
    create.mutate({ sessionId, createdAt: Date.now(), ...options });
    return sessionId;
  }

  return { sessions, isLoading, worktreeSessionIds: data?.worktreeSessionIds ?? [], createSession };
}

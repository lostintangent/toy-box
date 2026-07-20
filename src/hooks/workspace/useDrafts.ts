import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import { generateUUID } from "@/lib/utils";
import type { WorkspaceSessionState } from "@/lib/workspace/state";
import type { SessionMetadata } from "@/types";
import { useDispatchWorkspaceAction, useWorkspaceSelector } from "./state";

type DraftState = Extract<WorkspaceSessionState, { createdAt: number }>;

export function useDrafts({
  sessions,
  hyperSessionIds,
}: {
  sessions: SessionMetadata[];
  hyperSessionIds: string[];
}) {
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
  const drafts = useWorkspaceSelector((workspace) =>
    Object.entries(workspace.sessionStates).filter(
      (entry): entry is [string, DraftState] =>
        entry[1].status === "draft" || entry[1].status === "creating",
    ),
  );

  const hyperSessionIdSet = new Set(hyperSessionIds);
  const sessionIdsInList = new Set(sessions.map((session) => session.sessionId));
  const visibleDrafts = drafts.filter(
    ([sessionId]) => !hyperSessionIdSet.has(sessionId) && !sessionIdsInList.has(sessionId),
  );
  const reusableDraftId = visibleDrafts.find(
    ([, state]) => state.status === "draft" && !state.prompt?.text,
  )?.[0];

  const listedDrafts = visibleDrafts
    .sort(([, left], [, right]) => draftUpdatedAt(right) - draftUpdatedAt(left))
    .map(([sessionId, state]) => ({
      sessionId,
      startTime: new Date(state.createdAt),
      modifiedTime: new Date(draftUpdatedAt(state)),
      summary: "",
      isRemote: false,
    }));

  function isDraft(sessionId: string) {
    return drafts.some(([draftSessionId]) => draftSessionId === sessionId);
  }

  function createDraft(options?: { hyper?: boolean }) {
    const hyper = options?.hyper === true;

    if (!hyper && reusableDraftId) return reusableDraftId;

    const sessionId = `${SESSION_ID_PREFIX}${generateUUID()}`;
    dispatchWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: Date.now(),
      ...(hyper ? { hyper: true } : {}),
    });
    return sessionId;
  }

  function discardDraft(sessionId: string) {
    dispatchWorkspaceAction({ type: "session.draft.discarded", sessionId });
  }

  return { listedDrafts, isDraft, createDraft, discardDraft };
}

function draftUpdatedAt(state: DraftState): number {
  return state.prompt?.updatedAt ?? state.createdAt;
}

import { useCallback, useMemo } from "react";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import { generateUUID } from "@/lib/utils";
import type { DraftPrompt, DraftSession, SessionMetadata } from "@/types";
import type { WorkspaceActions } from "@/hooks/workspace/useWorkspace";

export type CreateDraftOptions = {
  hyper?: boolean;
};

export type CreateDraft = (options?: CreateDraftOptions) => string;

type UseDraftsOptions = {
  sessions: SessionMetadata[];
  drafts: DraftSession[];
  hyperSessionIds: string[];
  draftPromptsBySessionId: Record<string, DraftPrompt>;
  dispatchWorkspaceAction: WorkspaceActions["dispatchWorkspaceAction"];
};

function createOptimisticDraft(sessionId: string): DraftSession {
  const now = Date.now();
  return {
    sessionId,
    createdAt: now,
    updatedAt: now,
  };
}

export function draftToSessionMetadata(draft: DraftSession): SessionMetadata {
  return {
    sessionId: draft.sessionId,
    startTime: new Date(draft.createdAt),
    modifiedTime: new Date(draft.updatedAt),
    summary: "",
    isRemote: false,
  };
}

export function useDrafts({
  sessions,
  drafts,
  hyperSessionIds,
  draftPromptsBySessionId,
  dispatchWorkspaceAction,
}: UseDraftsOptions) {
  const hyperSessionIdSet = useMemo(() => new Set(hyperSessionIds), [hyperSessionIds]);
  const sessionIdsInList = useMemo(
    () => new Set(sessions.map((session) => session.sessionId)),
    [sessions],
  );
  const draftSessionIdSet = useMemo(
    () => new Set(drafts.map((draft) => draft.sessionId)),
    [drafts],
  );

  const listedDrafts = useMemo(
    () =>
      drafts
        .filter(
          (draft) =>
            !hyperSessionIdSet.has(draft.sessionId) && !sessionIdsInList.has(draft.sessionId),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(draftToSessionMetadata),
    [drafts, hyperSessionIdSet, sessionIdsInList],
  );

  const isDraft = useCallback(
    (sessionId: string) => draftSessionIdSet.has(sessionId),
    [draftSessionIdSet],
  );

  const hasPromptText = useCallback(
    (sessionId: string) => !!draftPromptsBySessionId[sessionId]?.text,
    [draftPromptsBySessionId],
  );

  const createDraft: CreateDraft = useCallback(
    (createOptions) => {
      const hyper = createOptions?.hyper === true;

      if (!hyper) {
        const existingDraft = listedDrafts.find((draft) => !hasPromptText(draft.sessionId));
        if (existingDraft) return existingDraft.sessionId;
      }

      const sessionId = `${SESSION_ID_PREFIX}${generateUUID()}`;
      const draft = createOptimisticDraft(sessionId);

      void dispatchWorkspaceAction({ type: "session.draft.created", draft });
      if (hyper) {
        void dispatchWorkspaceAction({ type: "session.hyper.created", sessionId });
      }

      return sessionId;
    },
    [dispatchWorkspaceAction, hasPromptText, listedDrafts],
  );

  const discardDraft = useCallback(
    (sessionId: string) => {
      void dispatchWorkspaceAction({ type: "session.draft.discarded", sessionId });
    },
    [dispatchWorkspaceAction],
  );

  return {
    listedDrafts,
    isDraft,
    createDraft,
    discardDraft,
  };
}

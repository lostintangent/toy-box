import { useMutation } from "@tanstack/react-query";
import { generateUUID } from "@/shared/utils";
import type { WorkspaceSessionState } from "@workspace/model/state/reducer";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { SESSION_ID_PREFIX } from "./model/constants";
import { sessionMutations } from "./mutations";

type DraftState = Extract<WorkspaceSessionState, { status: "draft" }>;
type CreateDraftOptions = { hyper?: true; artifact?: { path: string; content: string } };

export function useDrafts({ hiddenSessionIds }: { hiddenSessionIds: string[] }) {
  const createDraftMutation = useMutation(sessionMutations.createDraftSession());
  const drafts = useWorkspaceSelector((workspace) =>
    Object.entries(workspace.sessionStates).filter(
      (entry): entry is [string, DraftState] => entry[1].status === "draft",
    ),
  );

  const hiddenSessionIdSet = new Set(hiddenSessionIds);
  const visibleDrafts = drafts.filter(([sessionId]) => !hiddenSessionIdSet.has(sessionId));
  const reusableDraftId = visibleDrafts.find(
    ([, state]) => !state.prompt?.text && !state.artifactPath,
  )?.[0];

  const listedDrafts = visibleDrafts
    .sort(([, left], [, right]) => draftUpdatedAt(right) - draftUpdatedAt(left))
    .map(([sessionId, state]) => ({
      sessionId,
      startTime: new Date(state.createdAt),
      modifiedTime: new Date(draftUpdatedAt(state)),
      summary: draftArtifactLabel(state.artifactPath),
      isRemote: false,
    }));

  function isDraft(sessionId: string) {
    return drafts.some(([draftSessionId]) => draftSessionId === sessionId);
  }

  function createDraft(options?: CreateDraftOptions) {
    const hyper = options?.hyper === true;
    const artifact = options?.artifact;

    if (!hyper && !artifact && reusableDraftId) return reusableDraftId;

    const sessionId = `${SESSION_ID_PREFIX}${generateUUID()}`;
    createDraftMutation.mutate({
      sessionId,
      createdAt: Date.now(),
      ...(artifact ? { artifact } : {}),
      ...(hyper ? { hyper: true } : {}),
    });
    return sessionId;
  }

  return { listedDrafts, isDraft, createDraft };
}

function draftUpdatedAt(state: DraftState): number {
  return state.prompt?.updatedAt ?? state.createdAt;
}

function draftArtifactLabel(path?: string): string {
  if (path?.toLowerCase().endsWith(".md")) return "Draft document";
  if (path?.toLowerCase().endsWith(".svg")) return "Draft diagram";
  return "";
}

import { useQueryClient } from "@tanstack/react-query";
import { createDraftSession } from "@/functions/sessions";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import { generateUUID } from "@/lib/utils";
import type { WorkspaceSessionState } from "@/lib/workspace/state/reducer";
import { applyWorkspaceEvent, repairWorkspaceStateQuery } from "@/lib/workspace/state/query";
import { useWorkspaceSelector } from "./state";

type DraftState = Extract<WorkspaceSessionState, { status: "draft" }>;
type CreateDraftOptions = { hyper?: true; artifact?: { path: string; content: string } };

export function useDrafts({ hyperSessionIds }: { hyperSessionIds: string[] }) {
  const queryClient = useQueryClient();
  const drafts = useWorkspaceSelector((workspace) =>
    Object.entries(workspace.sessionStates).filter(
      (entry): entry is [string, DraftState] => entry[1].status === "draft",
    ),
  );

  const hyperSessionIdSet = new Set(hyperSessionIds);
  const visibleDrafts = drafts.filter(([sessionId]) => !hyperSessionIdSet.has(sessionId));
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
    applyWorkspaceEvent(queryClient, {
      type: "session.drafted",
      sessionId,
      createdAt: Date.now(),
      ...(artifact ? { artifactPath: artifact.path } : {}),
      ...(hyper ? { hyper: true } : {}),
    });

    void createDraftSession({
      data: {
        sessionId,
        ...(artifact ? { artifact } : {}),
        ...(hyper ? { hyper: true } : {}),
      },
    }).catch(async (error) => {
      console.error("Failed to create draft session:", error);
      await repairWorkspaceStateQuery(queryClient).catch((refreshError) => {
        console.error("Failed to refresh workspace state:", refreshError);
      });
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

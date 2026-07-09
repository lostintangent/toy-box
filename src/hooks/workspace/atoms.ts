import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";
import {
  createEmptyWorkspaceState,
  isWorkspaceSessionRunning,
  type WorkspaceSessionState,
  type WorkspaceState,
} from "@/lib/workspace/state";

/** Client projection of server workspace state. useWorkspace owns hydration,
 *  events, and writes; browser-local layout and preferences stay separate. */
export const workspaceStateAtom = atom<WorkspaceState>(createEmptyWorkspaceState());

const sessionStatesAtom = atom((get) => get(workspaceStateAtom).sessionStates);

/** One session's workspace lifecycle and draft-prompt state. */
const sessionStateAtom = atomFamily((sessionId: string) =>
  atom((get) => get(sessionStatesAtom)[sessionId]),
);

export const sessionPromptAtom = atomFamily((sessionId: string) =>
  atom((get) => get(sessionStateAtom(sessionId))?.prompt),
);

/** One session's lifecycle status; missing state is canonically idle. */
export const sessionStatusAtom = atomFamily((sessionId: string) =>
  atom((get) => get(sessionStateAtom(sessionId))?.status ?? "idle"),
);

export const sessionRunningAtom = atomFamily((sessionId: string) =>
  atom((get) => isWorkspaceSessionRunning(get(sessionStateAtom(sessionId)))),
);

export const sessionUnreadAtom = atomFamily((sessionId: string) =>
  atom((get) => get(sessionStatusAtom(sessionId)) === "unread"),
);

/** Draft/creating rows only; ordinary session activity leaves this projection stable. */
export const draftSessionStatesAtom = selectAtom(
  sessionStatesAtom,
  (states) =>
    Object.entries(states).filter(
      (entry): entry is [string, Extract<WorkspaceSessionState, { createdAt: number }>] =>
        entry[1].status === "draft" || entry[1].status === "creating",
    ),
  (left, right) =>
    left.length === right.length &&
    left.every(([id, state], index) => id === right[index][0] && state === right[index][1]),
);

export const hyperSessionIdsAtom = atom((get) => get(workspaceStateAtom).hyperSessionIds);
export const inboxEntriesAtom = selectAtom(
  workspaceStateAtom,
  (workspace) =>
    [...workspace.inboxEntries].sort((left, right) => {
      const leftRunning = isWorkspaceSessionRunning(workspace.sessionStates[left.id]);
      const rightRunning = isWorkspaceSessionRunning(workspace.sessionStates[right.id]);
      return (
        Number(rightRunning) - Number(leftRunning) || right.createdAt.localeCompare(left.createdAt)
      );
    }),
  (left, right) =>
    left.length === right.length && left.every((entry, index) => entry === right[index]),
);
export const customArtifactKindsAtom = atom((get) => get(workspaceStateAtom).customArtifacts);
export const workspaceEnvironmentAtom = atom((get) => get(workspaceStateAtom).environment);

const artifactCommentSessionsFamily = atomFamily(
  ([sourceSessionId, path]: readonly [string, string]) =>
    selectAtom(
      workspaceStateAtom,
      (workspace) =>
        workspace.artifactCommentSessions
          .filter(
            (commentSession) =>
              commentSession.sourceSessionId === sourceSessionId && commentSession.path === path,
          )
          .map((commentSession) => ({
            sessionId: commentSession.sessionId,
            threadId: commentSession.threadId,
          })),
      (left, right) =>
        left.length === right.length &&
        left.every(
          (commentSession, index) =>
            commentSession.sessionId === right[index].sessionId &&
            commentSession.threadId === right[index].threadId,
        ),
    ),
  (left, right) => left[0] === right[0] && left[1] === right[1],
);

/** Comment sessions currently responding to one artifact. */
export function artifactCommentSessionsAtom(sourceSessionId: string, path: string) {
  return artifactCommentSessionsFamily([sourceSessionId, path]);
}

export const hasUnreadInboxAtom = atom((get) =>
  get(inboxEntriesAtom).some((entry) => get(sessionUnreadAtom(entry.id))),
);

/** The workspace-managed Hyper session, when one exists. */
export const hyperSessionIdAtom = atom((get) => get(hyperSessionIdsAtom)[0]);

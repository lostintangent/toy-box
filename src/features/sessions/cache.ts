// React Query helpers for session-owned state.
//
// The durable session catalog and live session activity are separate
// `reducedQuery` entries. Workspace events update or invalidate only the session
// queries they identify; worktrees and managed-session ownership remain in the
// catalog.

import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCache } from "@workspace/sync";
import { draftSessionId } from "@workspace/model/state/drafts";
import type { SessionsState } from "./model";
import { isSessionReplacement } from "./model/catalog";
import { sessionQueries } from "./queries";
import { createInitialSessionState } from "./model/reducer";

export default {
  preload: (queryClient) =>
    Promise.all([
      queryClient.ensureQueryData(sessionQueries.state),
      queryClient.ensureQueryData(sessionQueries.activity),
    ]),
  applyEvent(queryClient, event) {
    sessionQueries.activity.apply(queryClient, event);
    switch (event.type) {
      case "session.upserted": {
        const current = readCatalog(queryClient)?.sessions.find(
          (session) => session.id === event.session.id,
        );
        if (isSessionReplacement(current, event.session)) {
          retireSessionDetail(queryClient, event.session.id);
        }
        sessionQueries.state.apply(queryClient, event);
        return;
      }
      case "session.deleted":
        sessionQueries.state.apply(queryClient, event);
        retireSessionDetail(queryClient, event.sessionId);
        return;
      case "automation.upserted":
        sessionQueries.state.apply(queryClient, event);
        return;
      case "automation.deleted":
        sessionQueries.state.apply(queryClient, event);
        retireSessionDetail(queryClient, event.automationId);
        return;
      case "session.touched":
        invalidateSessionQueries(queryClient, event.sessionId);
        return;
      case "session.running":
      case "session.waiting":
      case "session.background":
      case "session.unread":
        refetchIfOutsideCatalog(queryClient, event.sessionId);
        resumeSessionObservations(queryClient, event.sessionId);
        return;
      case "draft.changed": {
        const sessionId = draftSessionId(event.key);
        if (sessionId) refetchIfOutsideCatalog(queryClient, sessionId);
        return;
      }
    }
  },
  async refresh(queryClient) {
    resumeSessionObservations(queryClient);
    await Promise.all([
      sessionQueries.state.refresh(queryClient),
      sessionQueries.activity.refresh(queryClient),
    ]);
  },
} satisfies WorkspaceCache;

/** Reconcile a session's catalog entry and transcript after a lifecycle change. */
function invalidateSessionQueries(queryClient: QueryClient, sessionId: string): void {
  void queryClient.invalidateQueries({ queryKey: sessionQueries.state.queryKey, exact: true });
  void queryClient.invalidateQueries({
    queryKey: sessionQueries.detail(sessionId).queryKey,
    exact: true,
  });
}

/** Restarts each watched detail whose observation ended, such as after a failed heal, a
 *  retired replacement or a server restart, and leaves running ones alone. Nothing waits
 *  for the restart, because an observation lasts while its detail is watched. */
function resumeSessionObservations(queryClient: QueryClient, sessionId?: string): void {
  void queryClient.refetchQueries(
    {
      queryKey: sessionId ? sessionQueries.detail(sessionId).queryKey : sessionQueries.details(),
      type: "active",
    },
    { cancelRefetch: false },
  );
}

/** Reads the authoritative lifecycle after a draft's first send failed, because creation may
 *  have failed before or after the server created the session. A session it did create
 *  resumes its observation, which follows or heals any run the send started. */
export async function repairFailedDraft(queryClient: QueryClient, sessionId: string) {
  const { queryKey } = sessionQueries.detail(sessionId);
  void queryClient.cancelQueries({ queryKey, exact: true });
  await Promise.all([
    sessionQueries.state.repair(queryClient),
    sessionQueries.activity.repair(queryClient),
  ]);
  // The pane watches until it renders the repair, so the catalog decides, not its observer.
  if (readCatalog(queryClient)?.sessions.find(({ id }) => id === sessionId)?.provider) {
    resumeSessionObservations(queryClient, sessionId);
  }
}

function readCatalog(queryClient: QueryClient): SessionsState | undefined {
  return queryClient.getQueryData(sessionQueries.state.queryKey);
}

function retireSessionDetail(queryClient: QueryClient, sessionId: string): void {
  void queryClient.cancelQueries({
    queryKey: sessionQueries.detail(sessionId).queryKey,
    exact: true,
  });
  queryClient.setQueryData(sessionQueries.detail(sessionId).queryKey, (previous) =>
    previous ? createInitialSessionState() : undefined,
  );
}

/** Activity, including an unsent draft, can bring an older session back into the browsing window. */
function refetchIfOutsideCatalog(queryClient: QueryClient, sessionId: string): void {
  if (!readCatalog(queryClient)?.sessions.some(({ id }) => id === sessionId)) {
    void queryClient.invalidateQueries({ queryKey: sessionQueries.state.queryKey, exact: true });
  }
}

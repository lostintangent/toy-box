/**
 * Owns the lifecycle of a draft session: a client-generated session ID that
 * exists only in the browser until its first prompt creates the real session
 * on the server.
 *
 * Lifecycle, in order:
 * 1. `createDraft()` allocates a prefixed ID and makes it the active draft.
 * 2. The first prompt streams; when the server confirms the session exists,
 *    `promoteDraft(id)` swaps the draft for the server-backed session.
 * 3. `discardDraft()` abandons the draft without any server interaction
 *    (e.g. the user deletes it before sending anything).
 *
 * Relationship to useSession: this hook owns draft *identity* (which ID is a
 * draft, how it appears in the session list); useSession owns the *transport*
 * (sending the first prompt with `startNew` and observing the server's
 * confirmation). The two meet at exactly one point: the view passes
 * `promoteDraft` to useSession as `sessionConfig.onSessionCreated`.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prependSessionIfMissing } from "@/lib/session/sessionsCache";
import { generateUUID } from "@/lib/utils";
import type { SessionMetadata } from "@/types";

/** Session ID prefix for sessions created by this web app */
export const SESSION_ID_PREFIX = "toy-box-";

function toDraftMetadata(sessionId: string): SessionMetadata {
  return {
    sessionId,
    startTime: new Date(),
    modifiedTime: new Date(),
    summary: "",
    isRemote: false,
  };
}

export function useDraftSession(sessions: SessionMetadata[]) {
  const queryClient = useQueryClient();
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null);

  /** Allocate a new client-side draft ID (no server session yet). */
  const createDraft = useCallback(() => {
    const id = `${SESSION_ID_PREFIX}${generateUUID()}`;
    setDraftSessionId(id);
    return id;
  }, []);

  /** Promote the draft once the server confirms the session exists (first
   *  stream event). Prepends the session to the list cache so it persists
   *  across navigation, and clears the draft in the same pass — the cache
   *  write and state update batch into one render, so the sidebar swaps from
   *  draft entry to server entry atomically (no unmount/remount flicker).
   *  This is the single place where a draft becomes a real session. */
  const promoteDraft = useCallback(
    (sessionId: string) => {
      if (sessionId !== draftSessionId) return;

      prependSessionIfMissing(queryClient, toDraftMetadata(sessionId));
      setDraftSessionId(null);
    },
    [draftSessionId, queryClient],
  );

  /** Abandon the draft without any server interaction. */
  const discardDraft = useCallback(() => {
    setDraftSessionId(null);
  }, []);

  // Sidebar entry for the active draft (kept separate from the server list
  // for animation). Null once the session is in the server list, so the
  // server entry renders before the draft entry unmounts.
  const draftSession = useMemo<SessionMetadata | null>(() => {
    if (!draftSessionId) return null;
    if (sessions.some((s) => s.sessionId === draftSessionId)) return null;
    return toDraftMetadata(draftSessionId);
  }, [draftSessionId, sessions]);

  // Safety net: clear a stale draft if the session shows up in the server
  // list through another path (e.g. an SSE-driven refetch beats promoteDraft).
  useEffect(() => {
    if (draftSessionId && sessions.some((s) => s.sessionId === draftSessionId)) {
      setDraftSessionId(null);
    }
  }, [draftSessionId, sessions]);

  return { draftSessionId, draftSession, createDraft, promoteDraft, discardDraft };
}

// Draft record storage for server workspace state.
//
// Drafts are pre-session IDs that have not yet produced a persisted SDK
// session. Public transitions and broadcasts are composed by ./index.ts.

import type { DraftSession } from "@/types";
import { sharedMap } from "../../runtime/processState";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const drafts = sharedMap<DraftSession>("draft-sessions");

export function isDraftFresh(draft: DraftSession, now: number = Date.now()): boolean {
  return now - draft.updatedAt < DRAFT_TTL_MS;
}

export function getDrafts(): DraftSession[] {
  return Array.from(drafts.values());
}

export function getDraft(sessionId: string): DraftSession | undefined {
  return drafts.get(sessionId);
}

export function sweepExpiredDrafts(now: number = Date.now()): string[] {
  const expiredSessionIds: string[] = [];
  for (const draft of drafts.values()) {
    if (isDraftFresh(draft, now)) continue;
    drafts.delete(draft.sessionId);
    expiredSessionIds.push(draft.sessionId);
  }
  return expiredSessionIds;
}

export function isDraft(sessionId: string): boolean {
  return drafts.has(sessionId);
}

export function createDraftRecord(sessionId: string): DraftSession {
  const existing = drafts.get(sessionId);
  if (existing) return existing;

  const now = Date.now();
  const draft: DraftSession = {
    sessionId,
    createdAt: now,
    updatedAt: now,
  };
  drafts.set(sessionId, draft);
  return draft;
}

export function touchDraft(sessionId: string): void {
  const draft = drafts.get(sessionId);
  if (!draft) return;
  drafts.set(sessionId, { ...draft, updatedAt: Date.now() });
}

export function deleteDraftState(sessionId: string): boolean {
  return drafts.delete(sessionId);
}

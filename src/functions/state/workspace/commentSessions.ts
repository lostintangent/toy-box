// Process-local links between artifact comment threads and their child sessions.
// Canonical session state remains the lifecycle authority.

import { sharedMap } from "@/functions/runtime/processState";
import type { ArtifactCommentSession } from "@/types";

const sessions = sharedMap<ArtifactCommentSession>("artifact-comment-sessions");

export function getArtifactCommentSessions(): ArtifactCommentSession[] {
  return [...sessions.values()];
}

export function hasArtifactCommentSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function setArtifactCommentSession(commentSession: ArtifactCommentSession): void {
  sessions.set(commentSession.sessionId, commentSession);
}

export function deleteArtifactCommentSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function deleteArtifactCommentSessionsForSession(sessionId: string): string[] {
  const deleted: string[] = [];
  for (const [commentSessionId, commentSession] of sessions) {
    if (commentSessionId !== sessionId && commentSession.sourceSessionId !== sessionId) continue;
    sessions.delete(commentSessionId);
    deleted.push(commentSessionId);
  }
  return deleted;
}

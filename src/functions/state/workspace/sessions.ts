// Process-local workspace state for session lifecycle and draft prompts.

import {
  reduceWorkspaceSessionState,
  type WorkspaceSessionEvent,
  type WorkspaceSessionState,
} from "@/lib/workspace/state";
import type { DraftPrompt } from "@/types";
import { sharedMap } from "../../runtime/processState";

const SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const sessionStates = sharedMap<WorkspaceSessionState>("workspace-session-states");

export function getSessionStates(now: number = Date.now()): Record<string, WorkspaceSessionState> {
  const result: Record<string, WorkspaceSessionState> = {};
  for (const sessionId of sessionStates.keys()) {
    const state = getSessionState(sessionId, now);
    if (state) result[sessionId] = state;
  }
  return result;
}

export function getSessionState(
  sessionId: string,
  now: number = Date.now(),
): WorkspaceSessionState | undefined {
  const state = sessionStates.get(sessionId);
  if (!state) return undefined;

  const fresh = removeExpiredPrompt(state, now);
  if (!fresh) {
    sessionStates.delete(sessionId);
    return undefined;
  }
  if (fresh !== state) sessionStates.set(sessionId, fresh);
  return fresh;
}

export function applySessionState(event: WorkspaceSessionEvent, now: number = Date.now()): boolean {
  const sessionId = event.type === "session.upserted" ? event.session.sessionId : event.sessionId;
  const current = getSessionState(sessionId, now);
  const next = reduceWorkspaceSessionState(current, event);
  if (next === current) return false;

  if (next) sessionStates.set(sessionId, next);
  else sessionStates.delete(sessionId);
  return true;
}

export function setSessionPrompt(
  sessionId: string,
  text: string,
  origin: string,
  now: number = Date.now(),
): DraftPrompt | null {
  const current = getSessionState(sessionId, now);
  const existingPrompt = current?.prompt;
  const changed = existingPrompt?.text !== text;
  const prompt = !changed
    ? { ...existingPrompt, updatedAt: now }
    : { text, origin, updatedAt: now };

  applySessionState({ type: "session.prompt.drafted", sessionId, prompt }, now);
  return changed ? prompt : null;
}

export function isDraft(sessionId: string): boolean {
  const status = getSessionState(sessionId)?.status;
  return status === "draft" || status === "creating";
}

export function deleteSessionState(sessionId: string): boolean {
  return sessionStates.delete(sessionId);
}

export function sweepExpiredDrafts(now: number = Date.now()): string[] {
  const expired: string[] = [];
  for (const [sessionId, state] of sessionStates) {
    if (state.status !== "draft") continue;
    const updatedAt = state.prompt?.updatedAt ?? state.createdAt;
    if (now - updatedAt < SESSION_STATE_TTL_MS) continue;
    sessionStates.delete(sessionId);
    expired.push(sessionId);
  }
  return expired;
}

function removeExpiredPrompt(
  state: WorkspaceSessionState,
  now: number,
): WorkspaceSessionState | undefined {
  if (!state.prompt || now - state.prompt.updatedAt < SESSION_STATE_TTL_MS) return state;
  if (state.status === "idle") return undefined;

  const { prompt: _, ...withoutPrompt } = state;
  return withoutPrompt;
}

// Hyper session membership storage for server workspace state.
//
// A hyper session is kept outside the normal session list and hosted in the
// floating hyper surface. Membership has no TTL; process restart fails open.
// Public transitions and broadcasts are composed by ./index.ts.

import { sharedSet } from "../../runtime/processState";

const hyperSessionIds = sharedSet<string>("hyper-session-ids");

export function getHyperSessionIds(): string[] {
  return Array.from(hyperSessionIds);
}

export function hasHyperSession(sessionId: string): boolean {
  return hyperSessionIds.has(sessionId);
}

export function addHyperSession(sessionId: string): boolean {
  if (hyperSessionIds.has(sessionId)) return false;
  hyperSessionIds.add(sessionId);
  return true;
}

export function deleteHyperState(sessionId: string): boolean {
  return hyperSessionIds.delete(sessionId);
}

// Session classification projected from the domain record that manages it.
// No type is stored on the session itself: absence of a managing record means
// a standard session, while conflicting records are an invariant violation.

import { getAppDatabase } from "@/functions/state/database";
import { hasHyperSession } from "../workspace/hyperSessions";
import type { SessionType } from "@/types";

export async function resolveSessionType(sessionId: string): Promise<SessionType> {
  const database = await getAppDatabase({ createIfMissing: false });
  const row = database
    ? ((
        await database.sql`
          SELECT
            EXISTS(SELECT 1 FROM automations WHERE id = ${sessionId}) AS automation,
            EXISTS(SELECT 1 FROM inbox WHERE id = ${sessionId}) AS inbox,
            EXISTS(SELECT 1 FROM workers WHERE session_id = ${sessionId}) AS worker
        `
      ).rows?.[0] as SessionTypeClaims | undefined)
    : undefined;

  const types: SessionType[] = [];
  if (row?.automation) types.push("automation");
  if (row?.inbox) types.push("inbox");
  if (hasHyperSession(sessionId)) types.push("hyper");
  if (row?.worker) types.push("worker");

  if (types.length > 1) {
    throw new Error(`Session ${sessionId} has conflicting types: ${types.join(", ")}`);
  }
  return types[0] ?? "standard";
}

type SessionTypeClaims = {
  automation: number;
  inbox: number;
  worker: number;
};

// Inbox-owned Worker dispatch and result retention.

import { spawnWorker } from "@workers/server";
import type { Worker } from "@workers/model";
import { broadcast } from "@workspace/server/events";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import { ensureInboxRecovered, failInboxTask } from "./index";

/** Accept an Inbox task without attaching a client to its Worker. */
export async function dispatchInboxTask(input: SessionLaunch): Promise<{ sessionId: string }> {
  await ensureInboxRecovered();
  const { sessionId } = await spawnWorker({
    ...input,
    owner: { type: "inbox" },
    retention: retainInboxResult,
  });
  broadcast({ type: "inbox.changed" });
  return { sessionId };
}

async function retainInboxResult(worker: Worker, completion: SessionCompletion): Promise<boolean> {
  if (completion.status === "completed") return worker.metadata !== undefined;

  await failInboxTask(
    worker.sessionId,
    completion.error
      ? `This task failed: ${completion.error}`.slice(0, 4000)
      : "This task stopped before reporting an Inbox result.",
  );
  return true;
}

// Inbox-managed session dispatch and completion supervision.

import { createSession } from "@sessions/server/runtime";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import { createPendingInboxEntry, deleteInboxEntry, getInboxEntry } from "./index";

/** Accept an Inbox task and open its ordinary session runtime without attaching a client. */
export async function dispatchInboxTask(input: SessionLaunch): Promise<{ sessionId: string }> {
  const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  await createPendingInboxEntry(sessionId);

  let waitForCompletion: () => Promise<SessionCompletion>;
  try {
    const receipt = await createSession(sessionId, input.message, {
      directory: input.directory,
      useWorktree: input.useWorktree,
      sessionType: "inbox",
    });
    waitForCompletion = receipt.waitForCompletion;
  } catch (error) {
    await deleteInboxEntry(sessionId).catch(console.error);
    throw error;
  }

  void superviseInboxTask(sessionId, waitForCompletion).catch((error) => {
    console.error(`Failed to supervise inbox task ${sessionId}:`, error);
  });
  return { sessionId };
}

async function superviseInboxTask(
  sessionId: string,
  waitForCompletion: () => Promise<SessionCompletion>,
): Promise<void> {
  const completion = await waitForCompletion();
  if (completion.status !== "completed") return;

  const entry = await getInboxEntry(sessionId);
  if (!entry || entry.message !== undefined) return;

  await deleteInboxEntry(sessionId);
}

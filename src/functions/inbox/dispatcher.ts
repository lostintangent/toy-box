// Inbox-managed session dispatch and completion supervision.

import { createSession } from "@/functions/runtime/stream";
import type { SessionStreamCompletion } from "@/functions/runtime/stream";
import { deleteSessionIfExists } from "@/functions/state/session/registry";
import { createPendingInboxEntry, deleteInboxEntry } from "@/functions/state/workspace";
import { getInboxEntry } from "@/functions/state/workspace/inbox";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import type { SessionMessageInput } from "@/lib/session/protocol";

export type DispatchInboxTaskInput = {
  message: SessionMessageInput;
  directory?: string;
  useWorktree?: boolean;
};

/** Accept an Inbox task and open its ordinary session runtime without attaching a client. */
export async function dispatchInboxTask(
  input: DispatchInboxTaskInput,
): Promise<{ sessionId: string }> {
  const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  await createPendingInboxEntry(sessionId);

  let waitForCompletion: () => Promise<SessionStreamCompletion>;
  try {
    const receipt = await createSession(sessionId, input.message, {
      directory: input.directory,
      useWorktree: input.useWorktree,
      sessionType: "inbox",
    });
    waitForCompletion = receipt.waitForCompletion;
  } catch (error) {
    await cleanUpFailedDispatch(sessionId);
    throw error;
  }

  void superviseInboxTask(sessionId, waitForCompletion).catch((error) => {
    console.error(`Failed to supervise inbox task ${sessionId}:`, error);
  });
  return { sessionId };
}

async function superviseInboxTask(
  sessionId: string,
  waitForCompletion: () => Promise<SessionStreamCompletion>,
): Promise<void> {
  const completion = await waitForCompletion();
  if (completion.status !== "completed") return;

  const entry = await getInboxEntry(sessionId);
  if (!entry || entry.message !== undefined) return;

  await deleteSessionIfExists(sessionId);
  await deleteInboxEntry(sessionId);
}

async function cleanUpFailedDispatch(sessionId: string): Promise<void> {
  await deleteSessionIfExists(sessionId).catch(console.error);
  await deleteInboxEntry(sessionId).catch(console.error);
}

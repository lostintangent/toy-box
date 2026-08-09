import { deleteSessionIfExists } from "@sessions/server/runtime";
import { getWorkerSessionIdsForApp } from "./database";
import { finishWorkersForApp } from "./registry";
import { cancelWorker } from "./supervisor";

/** Remove every live or durable worker owned by a deleted app. */
export async function deleteWorkersForApp(appId: string): Promise<void> {
  const sessionIds = new Set([
    ...finishWorkersForApp(appId),
    ...(await getWorkerSessionIdsForApp(appId)),
  ]);
  const cleanup = await Promise.allSettled(
    [...sessionIds].map(async (sessionId) => {
      await cancelWorker(sessionId);
      await deleteSessionIfExists(sessionId);
    }),
  );
  for (const result of cleanup) {
    if (result.status === "rejected") {
      console.error("Unable to clean up an app worker:", result.reason);
    }
  }
}

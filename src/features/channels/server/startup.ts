import { getStateDatabase } from "@/server/database";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { getSessionActivity } from "@sessions/server/state/activity";
import { listWorkers } from "@workers/server";
import { ChannelDatabase } from "./database";
import { publishChannelChange, wakeDueChannelAgents } from "./index";
import { startChannelPush } from "./push";

/** Working status belongs to an execution; waiting survives it and can schedule a wake. */
export default async function startChannels(): Promise<VoidFunction> {
  const db = await getStateDatabase();
  const channels = new ChannelDatabase(db);
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (event.type === "session.idle" || event.type === "session.unread") {
      void clearWorkingStatus(event.sessionId);
    }
  });
  for (const worker of await listWorkers("channel")) {
    const status = getSessionActivity(worker.sessionId)?.status;
    if (status !== "running" && status !== "waiting") await clearWorkingStatus(worker.sessionId);
  }
  const timer = setInterval(() => void wakeDueChannelAgents(), 60_000);
  timer.unref?.();
  const stopPush = startChannelPush();
  return () => {
    stopPush();
    unsubscribe();
    clearInterval(timer);
  };

  function clearWorkingStatus(agentId: string) {
    // Enqueue synchronously so a subsequent turn's status write follows this clear.
    return channels
      .clearAgentStatus(agentId, "working")
      .then((change) => {
        if (change) publishChannelChange(change);
      })
      .catch((error: unknown) => console.error("Failed to clear Channel working status:", error));
  }
}
